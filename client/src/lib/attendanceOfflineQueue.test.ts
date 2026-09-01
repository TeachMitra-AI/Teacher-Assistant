import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  enqueueAction,
  getQueue,
  getQueuedAction,
  attemptSync,
  retryQueuedAction,
  discardQueuedAction,
  subscribeToQueue,
} from './attendanceOfflineQueue';
import { ApiError } from '../api';
import * as attendanceApi from './teacherAttendanceApi';

vi.mock('./teacherAttendanceApi', () => ({ checkIn: vi.fn(), checkOut: vi.fn() }));

const mockedApi = vi.mocked(attendanceApi);
const EVIDENCE = { lat: 12.9716, lon: 77.5946, accuracyMeters: 15 };

// This test environment's jsdom/Node combination doesn't expose a working
// global `localStorage` (a pre-existing environment gap, not a bug in
// attendanceOfflineQueue.ts itself — a real browser's localStorage works
// fine; this codebase simply never had a test touch real localStorage
// before this file). Stubbed locally here rather than in the shared
// vitest.config.ts, so this fix stays scoped to the one file that needs it.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.clearAllMocks();
});

describe('enqueueAction', () => {
  test('stores an item, retrievable by user and by key', () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);

    expect(getQueue('u1')).toHaveLength(1);
    expect(getQueuedAction('u1', '2026-08-29', 'check-in')).toMatchObject({ userId: 'u1', evidence: EVIDENCE });
  });

  test('a second attempt for the same user+date+kind coalesces, not duplicates', () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    enqueueAction('u1', '2026-08-29', 'check-in', { ...EVIDENCE, accuracyMeters: 5 });

    expect(getQueue('u1')).toHaveLength(1);
    expect(getQueuedAction('u1', '2026-08-29', 'check-in')?.evidence.accuracyMeters).toBe(5);
  });

  test('check-in and check-out for the same day are separate queue entries', () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    enqueueAction('u1', '2026-08-29', 'check-out', EVIDENCE);

    expect(getQueue('u1')).toHaveLength(2);
  });

  test('notifies subscribers on enqueue', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueue(listener);
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('attemptSync', () => {
  test('a successful sync removes the item from the queue', async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    mockedApi.checkIn.mockResolvedValue({ attendance: {} as never });

    await attemptSync('u1');

    expect(getQueue('u1')).toHaveLength(0);
  });

  test('calls checkOut, not checkIn, for a queued check-out', async () => {
    enqueueAction('u1', '2026-08-29', 'check-out', EVIDENCE);
    mockedApi.checkOut.mockResolvedValue({ attendance: {} as never });

    await attemptSync('u1');

    expect(mockedApi.checkOut).toHaveBeenCalledWith(EVIDENCE);
    expect(mockedApi.checkIn).not.toHaveBeenCalled();
  });

  test('a network failure keeps the item queued, backs off, and stops the rest of the pass', async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    enqueueAction('u1', '2026-08-30', 'check-in', EVIDENCE);
    mockedApi.checkIn.mockRejectedValue(new ApiError('Network error.', 0));

    await attemptSync('u1');

    expect(getQueue('u1')).toHaveLength(2); // neither synced nor discarded
    expect(mockedApi.checkIn).toHaveBeenCalledTimes(1); // second item never attempted this pass
    const item = getQueuedAction('u1', '2026-08-29', 'check-in');
    expect(item?.attempts).toBe(1);
    expect(item?.nextRetryAt).toBeGreaterThan(Date.now());
  });

  test('a real rejection marks the item permanently errored and moves on to the next one', async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    enqueueAction('u1', '2026-08-30', 'check-in', EVIDENCE);
    mockedApi.checkIn
      .mockRejectedValueOnce(new ApiError('You already checked in today.', 409))
      .mockResolvedValueOnce({ attendance: {} as never });

    await attemptSync('u1');

    expect(mockedApi.checkIn).toHaveBeenCalledTimes(2); // the pass continued past the permanent error
    const stuck = getQueuedAction('u1', '2026-08-29', 'check-in');
    expect(stuck?.permanentError).toBeTruthy();
    expect(getQueuedAction('u1', '2026-08-30', 'check-in')).toBeNull(); // synced and removed
  });

  test('skips an item that already has a permanent error', async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    mockedApi.checkIn.mockRejectedValueOnce(new ApiError('Rejected.', 400));
    await attemptSync('u1'); // sets permanentError

    mockedApi.checkIn.mockClear();
    await attemptSync('u1'); // second pass should not retry it

    expect(mockedApi.checkIn).not.toHaveBeenCalled();
  });

  test("never touches another user's queued items", async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    enqueueAction('u2', '2026-08-29', 'check-in', EVIDENCE);
    mockedApi.checkIn.mockResolvedValue({ attendance: {} as never });

    await attemptSync('u1');

    expect(getQueue('u1')).toHaveLength(0);
    expect(getQueue('u2')).toHaveLength(1);
  });
});

describe('retryQueuedAction / discardQueuedAction', () => {
  test('retry clears the permanent error and attempts again', async () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    mockedApi.checkIn.mockRejectedValueOnce(new ApiError('Rejected.', 400));
    await attemptSync('u1');
    const key = getQueuedAction('u1', '2026-08-29', 'check-in')!.key;

    mockedApi.checkIn.mockResolvedValueOnce({ attendance: {} as never });
    await retryQueuedAction(key, 'u1');

    expect(getQueue('u1')).toHaveLength(0);
  });

  test('discard removes the item without ever calling the API', () => {
    enqueueAction('u1', '2026-08-29', 'check-in', EVIDENCE);
    const key = getQueuedAction('u1', '2026-08-29', 'check-in')!.key;

    discardQueuedAction(key);

    expect(getQueue('u1')).toHaveLength(0);
    expect(mockedApi.checkIn).not.toHaveBeenCalled();
  });
});
