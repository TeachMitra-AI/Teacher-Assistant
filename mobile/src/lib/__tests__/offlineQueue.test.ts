// Unit tests for the Phase 12 offline attendance queue (docs/mobile-app-plan.md
// §18/§26). api/classroomApi.ts's saveAttendance is mocked — this suite is
// about queue mechanics (enqueue/coalesce/persist/retry/backoff/ownership),
// not the request shape, which attendance.test.ts/classroomApi.test.ts
// already cover. AsyncStorage is jest.setup.ts's shared in-memory fake;
// AsyncStorage.clear() between tests gives each test a clean queue, mirroring
// how a real app restart reads whatever was last written and nothing more.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { ApiError } from '../../api/client';
import {
  attemptSync,
  buildQueueKey,
  discardQueuedItem,
  enqueueAttendanceSave,
  getQueue,
  getQueuedItem,
  removeFromQueue,
  retryQueuedItem,
  startAutoSync,
  subscribeToQueue,
} from '../offlineQueue';

jest.mock('../../api/classroomApi', () => ({ saveAttendance: jest.fn() }));
const { saveAttendance } = jest.requireMock('../../api/classroomApi') as { saveAttendance: jest.Mock };

const MARKS_A = [{ studentId: 's1', status: 'present' as const }];
const MARKS_B = [{ studentId: 's1', status: 'absent' as const }];

describe('offlineQueue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    saveAttendance.mockReset();
    jest.restoreAllMocks();
  });

  it('enqueue persists a queued item retrievable by getQueue/getQueuedItem', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);

    const all = await getQueue('u1');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ userId: 'u1', classId: 'c1', date: '2026-01-05', marks: MARKS_A });

    const item = await getQueuedItem('u1', 'c1', '2026-01-05');
    expect(item?.key).toBe(buildQueueKey('u1', 'c1', '2026-01-05'));
  });

  it('persists across a simulated app restart (fresh read from storage)', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);

    // "Restart" = nothing but AsyncStorage survives; every queue function
    // reads fresh from storage rather than trusting any in-memory cache.
    const afterRestart = await getQueue('u1');
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0].marks).toEqual(MARKS_A);
  });

  it('coalesces a second offline save for the same user+class+date instead of appending', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_B);

    const all = await getQueue('u1');
    expect(all).toHaveLength(1);
    expect(all[0].marks).toEqual(MARKS_B); // latest snapshot wins
  });

  it('does not coalesce different dates/classes/users', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c1', '2026-01-06', MARKS_B);
    await enqueueAttendanceSave('u1', 'c2', '2026-01-05', MARKS_B);
    await enqueueAttendanceSave('u2', 'c1', '2026-01-05', MARKS_B);

    expect(await getQueue('u1')).toHaveLength(3);
    expect(await getQueue()).toHaveLength(4);
  });

  it('removeFromQueue removes only the targeted item', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c2', '2026-01-05', MARKS_B);

    await removeFromQueue(buildQueueKey('u1', 'c1', '2026-01-05'));

    const remaining = await getQueue('u1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].classId).toBe('c2');
  });

  it('attemptSync processes items in creation order and removes each on success', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c2', '2026-01-06', MARKS_B);
    saveAttendance.mockResolvedValue({ date: 'x', saved: 1 });

    await attemptSync('u1');

    expect(saveAttendance).toHaveBeenCalledTimes(2);
    expect(saveAttendance.mock.calls[0]).toEqual(['c1', '2026-01-05', MARKS_A]);
    expect(saveAttendance.mock.calls[1]).toEqual(['c2', '2026-01-06', MARKS_B]);
    expect(await getQueue('u1')).toHaveLength(0);
  });

  it('a network failure sets exponential backoff and stops the pass without dropping the item', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c2', '2026-01-06', MARKS_B);
    saveAttendance.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));

    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await attemptSync('u1');

    // Only the first (oldest) item was attempted — a network failure stops
    // the whole pass rather than hammering the rest.
    expect(saveAttendance).toHaveBeenCalledTimes(1);
    const remaining = await getQueue('u1');
    expect(remaining).toHaveLength(2);
    const failed = remaining.find((i) => i.classId === 'c1')!;
    expect(failed.attempts).toBe(1);
    expect(failed.nextRetryAt).toBe(1_000_000 + 5000); // initial ~5s backoff
  });

  it('backoff doubles on repeated failures and caps at the maximum delay', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockRejectedValue(new ApiError('Network error. Please check your connection.', 0));

    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    // Attempt repeatedly, advancing the clock past each item's own backoff
    // each time, and confirm the delay grows then caps at 5 minutes.
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await attemptSync('u1');
      const item = (await getQueue('u1'))[0];
      delays.push(item.nextRetryAt - now);
      now = item.nextRetryAt; // jump straight to the next eligible attempt
    }

    expect(delays[0]).toBe(5000);
    expect(delays[1]).toBe(10000);
    expect(delays[2]).toBe(20000);
    expect(delays[delays.length - 1]).toBe(5 * 60 * 1000); // capped
  });

  it('does not retry an item before its backoff has elapsed', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    await attemptSync('u1'); // first failure -> nextRetryAt = 5000
    expect(saveAttendance).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(4999); // not due yet
    await attemptSync('u1');
    expect(saveAttendance).toHaveBeenCalledTimes(1); // no new attempt

    saveAttendance.mockResolvedValueOnce({ date: 'x', saved: 1 });
    nowSpy.mockReturnValue(5000); // due now
    await attemptSync('u1');
    expect(saveAttendance).toHaveBeenCalledTimes(2);
    expect(await getQueue('u1')).toHaveLength(0);
  });

  it('a non-network (permanent) failure stops auto-retry for that item but continues the pass', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u1', 'c2', '2026-01-06', MARKS_B);
    saveAttendance
      .mockRejectedValueOnce(new ApiError('One or more students in this request do not belong to this class.', 400))
      .mockResolvedValueOnce({ date: 'x', saved: 1 });

    await attemptSync('u1');

    expect(saveAttendance).toHaveBeenCalledTimes(2); // the second item is still attempted
    const remaining = await getQueue('u1');
    expect(remaining).toHaveLength(1); // c1 stays queued (not silently discarded), c2 synced and was removed
    expect(remaining[0].classId).toBe('c1');
    expect(remaining[0].permanentError).toBeTruthy();
  });

  it('does not retry a permanent-error item automatically on a later attemptSync pass', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockRejectedValueOnce(new ApiError('Invalid.', 400));
    await attemptSync('u1');
    expect(saveAttendance).toHaveBeenCalledTimes(1);

    await attemptSync('u1'); // a second automatic pass must skip it
    expect(saveAttendance).toHaveBeenCalledTimes(1);
  });

  it('retryQueuedItem clears the permanent error and attempts sync immediately', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockRejectedValueOnce(new ApiError('Invalid.', 400));
    await attemptSync('u1');
    expect((await getQueue('u1'))[0].permanentError).toBeTruthy();

    saveAttendance.mockResolvedValueOnce({ date: 'x', saved: 1 });
    await retryQueuedItem(buildQueueKey('u1', 'c1', '2026-01-05'), 'u1');

    expect(await getQueue('u1')).toHaveLength(0);
  });

  it('discardQueuedItem removes the item without attempting to sync it', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);

    await discardQueuedItem(buildQueueKey('u1', 'c1', '2026-01-05'));

    expect(saveAttendance).not.toHaveBeenCalled();
    expect(await getQueue('u1')).toHaveLength(0);
  });

  it('user ownership: attemptSync for one user never syncs another user\'s queued items', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u2', 'c9', '2026-01-05', MARKS_B);
    saveAttendance.mockResolvedValue({ date: 'x', saved: 1 });

    await attemptSync('u1');

    expect(saveAttendance).toHaveBeenCalledTimes(1);
    expect(saveAttendance).toHaveBeenCalledWith('c1', '2026-01-05', MARKS_A);
    const u2Queue = await getQueue('u2');
    expect(u2Queue).toHaveLength(1); // untouched — still there for u2 to sync later
  });

  it('getQueue(userId) filters strictly by ownership', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    await enqueueAttendanceSave('u2', 'c1', '2026-01-05', MARKS_B);

    expect(await getQueue('u1')).toHaveLength(1);
    expect(await getQueue('u2')).toHaveLength(1);
    expect(await getQueue()).toHaveLength(2);
  });

  it('prevents concurrent attemptSync executions from double-processing the same item', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    let resolveSave!: (v: { date: string; saved: number }) => void;
    saveAttendance.mockReturnValueOnce(new Promise((r) => { resolveSave = r; }));

    const first = attemptSync('u1');
    const second = attemptSync('u1'); // fires while the first is still in flight

    resolveSave({ date: 'x', saved: 1 });
    await Promise.all([first, second]);

    // A concurrent second call must be a no-op, not a duplicate sync attempt.
    expect(saveAttendance).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on enqueue, sync success, and removal', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToQueue(listener);

    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    expect(listener).toHaveBeenCalledTimes(1);

    saveAttendance.mockResolvedValueOnce({ date: 'x', saved: 1 });
    await attemptSync('u1');
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    listener.mockClear();
    await enqueueAttendanceSave('u1', 'c1', '2026-01-06', MARKS_A);
    expect(listener).not.toHaveBeenCalled();
  });

  it('startAutoSync triggers a sync on a NetInfo reconnect transition, not on a stable-connected event', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockResolvedValue({ date: 'x', saved: 1 });

    const stop = startAutoSync(() => 'u1');
    const listener = (NetInfo.addEventListener as jest.Mock).mock.calls[0][0] as (s: { isConnected: boolean }) => void;

    listener({ isConnected: true }); // still "connected" from the assumed-true baseline — no transition
    await Promise.resolve();
    expect(saveAttendance).not.toHaveBeenCalled();

    listener({ isConnected: false });
    listener({ isConnected: true }); // a real disconnect -> reconnect transition
    await Promise.resolve();
    await Promise.resolve();
    expect(saveAttendance).toHaveBeenCalledTimes(1);

    stop();
  });

  it('startAutoSync triggers a sync when AppState becomes active', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    saveAttendance.mockResolvedValue({ date: 'x', saved: 1 });

    const stop = startAutoSync(() => 'u1');
    const handler = (AppState.addEventListener as jest.Mock).mock.calls[0][1] as (s: string) => void;

    handler('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(saveAttendance).toHaveBeenCalledTimes(1);
    stop();
  });

  it('startAutoSync does nothing when no user is signed in', async () => {
    await enqueueAttendanceSave('u1', 'c1', '2026-01-05', MARKS_A);
    const stop = startAutoSync(() => null);
    const handler = (AppState.addEventListener as jest.Mock).mock.calls[0][1] as (s: string) => void;

    handler('active');
    await Promise.resolve();

    expect(saveAttendance).not.toHaveBeenCalled();
    stop();
  });
});
