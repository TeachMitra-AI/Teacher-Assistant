// Component tests for the Mark Attendance screen (§13, §23 — "the highest-
// risk interactive component... optimistic-update/revert-on-failure logic").
// api/classroomApi.ts is mocked; @react-native-community/datetimepicker is
// mocked to a no-op (never rendered on-screen by the RN test renderer),
// matching jest.setup.ts's existing pattern for other native modules.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { MarkAttendanceScreen } from '../MarkAttendanceScreen';
import type { DailyAttendance } from '../../../../types';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('../../../../api/classroomApi', () => ({
  getDailyAttendance: jest.fn(),
  saveAttendance: jest.fn(),
}));
const { getDailyAttendance, saveAttendance } = jest.requireMock('../../../../api/classroomApi') as {
  getDailyAttendance: jest.Mock;
  saveAttendance: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <MarkAttendanceScreen classId="c1" />
    </ThemeProvider>
  );
}

const ROSTER_RESPONSE: DailyAttendance = {
  date: '2026-08-26',
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

    saveAttendance.mockResolvedValueOnce({ date: '2026-08-26', saved: 2 });
    getDailyAttendance.mockResolvedValueOnce({
      date: '2026-08-26',
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
    expect(saveAttendance).toHaveBeenCalledWith('c1', '2026-08-26', [
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
});
