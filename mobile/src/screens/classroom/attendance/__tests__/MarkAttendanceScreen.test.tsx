// Component tests for the Mark Attendance screen (§13, §23 — "the highest-
// risk interactive component... optimistic-update/revert-on-failure logic").
// api/classroomApi.ts is mocked; @react-native-community/datetimepicker is
// mocked to a no-op (never rendered on-screen by the RN test renderer),
// matching jest.setup.ts's existing pattern for other native modules.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { MarkAttendanceScreen } from '../MarkAttendanceScreen';
import { todayDateString } from '../../../../lib/classroomDate';
import type { DailyAttendance } from '../../../../types';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

// The hook under test fixes its own "today" from the real clock at module
// load (see useMarkAttendanceScreen.ts's module-level `TODAY`), so the
// roster fixture's date must track the real day rather than a hardcoded
// string — otherwise this suite rots the day after whichever date it was
// written on.
const TODAY = todayDateString();

jest.mock('../../../../api/classroomApi', () => ({
  getDailyAttendance: jest.fn(),
  saveAttendance: jest.fn(),
}));
const { getDailyAttendance, saveAttendance } = jest.requireMock('../../../../api/classroomApi') as {
  getDailyAttendance: jest.Mock;
  saveAttendance: jest.Mock;
};

// Same pattern as CoachScreen.test.tsx — useAuth is mocked directly rather
// than going through a real AuthProvider, since this suite is about the
// screen's own behavior (auth is RootNavigator.test.tsx's job).
jest.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', role: 'teacher', preferences: {} } }),
}));

// Phase 12 (§18) — the offline queue module itself is covered by
// offlineQueue.test.ts; here it's mocked at the module boundary so this
// suite can control exactly what the screen sees a queued/pending/errored
// entry as, the same way api/classroomApi is mocked above.
jest.mock('../../../../lib/offlineQueue', () => ({
  buildQueueKey: (userId: string, classId: string, date: string) => `${userId}:${classId}:${date}`,
  enqueueAttendanceSave: jest.fn(),
  getQueuedItem: jest.fn(),
  subscribeToQueue: jest.fn(() => jest.fn()),
  retryQueuedItem: jest.fn(),
  discardQueuedItem: jest.fn(),
}));
const { enqueueAttendanceSave, getQueuedItem, retryQueuedItem, discardQueuedItem } = jest.requireMock(
  '../../../../lib/offlineQueue'
) as {
  enqueueAttendanceSave: jest.Mock;
  getQueuedItem: jest.Mock;
  retryQueuedItem: jest.Mock;
  discardQueuedItem: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <MarkAttendanceScreen classId="c1" />
    </ThemeProvider>
  );
}

const ROSTER_RESPONSE: DailyAttendance = {
  date: TODAY,
  roster: [
    { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'unmarked' },
    { studentId: 's2', name: 'Ben', rollNumber: '2', status: 'present' },
  ],
  summary: { present: 1, absent: 0, unmarked: 1, percentage: 100 },
};

describe('MarkAttendanceScreen', () => {
  beforeEach(() => {
    getDailyAttendance.mockReset();
    saveAttendance.mockReset();
    enqueueAttendanceSave.mockReset();
    retryQueuedItem.mockReset();
    discardQueuedItem.mockReset();
    // Default: no queued item for this class/date — every pre-Phase-12 test
    // below relies on this to see no offline-queue UI at all.
    getQueuedItem.mockReset().mockResolvedValue(null);
  });

  it('shows a loading state, then the roster with each student\'s loaded status', async () => {
    let resolveLoad!: (v: DailyAttendance) => void;
    getDailyAttendance.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading roster…')).toBeTruthy();
    await act(async () => {
      resolveLoad(ROSTER_RESPONSE);
    });

    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getByText('Ben')).toBeTruthy();
    // Ben was loaded as present -> live summary already reflects it.
    expect(screen.getByTestId('attendance-present-s2').props.accessibilityState.selected).toBe(true);
  });

  it('tapping Present updates the row and the live summary instantly, without saving', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('attendance-present-s1'));

    expect(screen.getByTestId('attendance-present-s1').props.accessibilityState.selected).toBe(true);
    // Save must NOT have fired on tap — only local/optimistic state changed.
    expect(saveAttendance).not.toHaveBeenCalled();
  });

  it('tapping the already-active toggle clears it back to Unmarked', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Ben')).toBeTruthy());

    expect(screen.getByTestId('attendance-present-s2').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('attendance-present-s2'));
    expect(screen.getByTestId('attendance-present-s2').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('attendance-absent-s2').props.accessibilityState.selected).toBe(false);
  });

  it('Save Attendance is disabled until something is dirty, and disabled again after a successful save', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    expect(screen.getByTestId('attendance-save-button').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('attendance-present-s1'));
    expect(screen.getByTestId('attendance-save-button').props.accessibilityState?.disabled).toBeFalsy();

    saveAttendance.mockResolvedValueOnce({ date: TODAY, saved: 2 });
    getDailyAttendance.mockResolvedValueOnce({
      date: TODAY,
      roster: [
        { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'present' },
        { studentId: 's2', name: 'Ben', rollNumber: '2', status: 'present' },
      ],
      summary: { present: 2, absent: 0, unmarked: 0, percentage: 100 },
    });

    await fireEvent.press(screen.getByTestId('attendance-save-button'));

    // One bulk POST with every roster row, "unmarked" included explicitly
    // for s2's untouched state — never a per-tap save.
    expect(saveAttendance).toHaveBeenCalledTimes(1);
    expect(saveAttendance).toHaveBeenCalledWith('c1', TODAY, [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'present' },
    ]);

    // Reloaded from the server response afterward — the source of truth.
    await waitFor(() => expect(getDailyAttendance).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('attendance-save-button').props.accessibilityState?.disabled).toBe(true));
  });

  it('Mark all Present sets every row to present without saving', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('attendance-mark-all-present'));

    expect(screen.getByTestId('attendance-present-s1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('attendance-present-s2').props.accessibilityState.selected).toBe(true);
    expect(saveAttendance).not.toHaveBeenCalled();
  });

  it('disables the next-date control once the loaded date is today', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    expect(screen.getByLabelText('Next date').props.accessibilityState?.disabled).toBe(true);
  });

  it('shows an inline error with a working retry', async () => {
    getDailyAttendance.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
  });

  // ---- Phase 12: offline queueing ------------------------------------------

  it('a network failure at save time queues the snapshot instead of showing an error', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('attendance-present-s1'));

    saveAttendance.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));
    await fireEvent.press(screen.getByTestId('attendance-save-button'));

    await waitFor(() =>
      expect(enqueueAttendanceSave).toHaveBeenCalledWith('u1', 'c1', TODAY, [
        { studentId: 's1', status: 'present' },
        { studentId: 's2', status: 'present' },
      ])
    );
    expect(screen.getByTestId('attendance-pending-sync')).toBeTruthy();
    expect(screen.getByText("Saved locally — will sync when you're back online.")).toBeTruthy();
    // Not treated as a failure — no error banner, and load() is never
    // re-called since there is nothing new to fetch from the server yet.
    expect(getDailyAttendance).toHaveBeenCalledTimes(1);
  });

  it('a second offline edit re-enqueues (coalesces) even when it matches the pre-offline server state', async () => {
    // Regression test for a bug found via manual device testing: dirty-check
    // must compare against the just-queued snapshot, not the stale
    // pre-offline `roster`, or a second offline edit that happens to match
    // the original server state reads as "not dirty" and is silently
    // dropped instead of coalescing.
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('attendance-present-s1'));

    saveAttendance.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));
    await fireEvent.press(screen.getByTestId('attendance-save-button'));
    await waitFor(() => expect(enqueueAttendanceSave).toHaveBeenCalledTimes(1));

    // Tapping the now-active Present toggle again clears s1 back to
    // Unmarked — which is exactly ROSTER_RESPONSE's original loaded value,
    // the case that silently no-opped before the fix.
    await fireEvent.press(screen.getByTestId('attendance-present-s1'));
    expect(screen.getByTestId('attendance-save-button').props.accessibilityState?.disabled).toBeFalsy();

    saveAttendance.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));
    await fireEvent.press(screen.getByTestId('attendance-save-button'));

    await waitFor(() => expect(enqueueAttendanceSave).toHaveBeenCalledTimes(2));
    expect(enqueueAttendanceSave).toHaveBeenLastCalledWith('u1', 'c1', TODAY, [
      { studentId: 's1', status: 'unmarked' },
      { studentId: 's2', status: 'present' },
    ]);
  });

  it('a genuine (non-network) save failure still shows the existing error banner, not the queue', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('attendance-present-s1'));

    saveAttendance.mockRejectedValueOnce(new ApiError('One or more students in this request do not belong to this class.', 400));
    await fireEvent.press(screen.getByTestId('attendance-save-button'));

    await waitFor(() =>
      expect(screen.getByText('One or more students in this request do not belong to this class.')).toBeTruthy()
    );
    expect(enqueueAttendanceSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('attendance-pending-sync')).toBeNull();
  });

  it('shows a pending-sync entry already queued for this class/date on load', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    getQueuedItem.mockResolvedValue({
      key: `u1:c1:${TODAY}`,
      userId: 'u1',
      classId: 'c1',
      date: TODAY,
      marks: [],
      createdAt: 0,
      updatedAt: 0,
      attempts: 0,
      nextRetryAt: 0,
      permanentError: null,
    });
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('attendance-pending-sync')).toBeTruthy());
  });

  it('surfaces a permanent sync error with a manual Retry action', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    getQueuedItem.mockResolvedValue({
      key: `u1:c1:${TODAY}`,
      userId: 'u1',
      classId: 'c1',
      date: TODAY,
      marks: [],
      createdAt: 0,
      updatedAt: 0,
      attempts: 3,
      nextRetryAt: 0,
      permanentError: 'Could not sync this attendance save. It has not been lost — you can retry or discard it.',
    });
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('attendance-queue-error')).toBeTruthy());
    expect(screen.queryByTestId('attendance-pending-sync')).toBeNull(); // error state, not the plain pending state

    await fireEvent.press(screen.getByTestId('attendance-queue-retry'));
    expect(retryQueuedItem).toHaveBeenCalledWith(`u1:c1:${TODAY}`, 'u1');
  });

  it('Discard requires confirmation before removing the queued item', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    getQueuedItem.mockResolvedValue({
      key: `u1:c1:${TODAY}`,
      userId: 'u1',
      classId: 'c1',
      date: TODAY,
      marks: [],
      createdAt: 0,
      updatedAt: 0,
      attempts: 3,
      nextRetryAt: 0,
      permanentError: 'Could not sync this attendance save. It has not been lost — you can retry or discard it.',
    });
    // Simulate the user dismissing the confirmation without confirming.
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByTestId('attendance-queue-discard')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('attendance-queue-discard'));
    expect(Alert.alert).toHaveBeenCalled();
    expect(discardQueuedItem).not.toHaveBeenCalled();
  });

  it('confirmed Discard removes the queue item', async () => {
    getDailyAttendance.mockResolvedValueOnce(ROSTER_RESPONSE);
    getQueuedItem.mockResolvedValue({
      key: `u1:c1:${TODAY}`,
      userId: 'u1',
      classId: 'c1',
      date: TODAY,
      marks: [],
      createdAt: 0,
      updatedAt: 0,
      attempts: 3,
      nextRetryAt: 0,
      permanentError: 'Could not sync this attendance save. It has not been lost — you can retry or discard it.',
    });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByTestId('attendance-queue-discard')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('attendance-queue-discard'));
    expect(discardQueuedItem).toHaveBeenCalledWith(`u1:c1:${TODAY}`);
  });
});
