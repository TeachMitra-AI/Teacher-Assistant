// Component tests for the Fees screen (§14, §23 — the amount-entry/save
// interaction is the highest-risk part of this screen, mirroring
// MarkAttendanceScreen.test.tsx's coverage shape for Attendance).
// api/classroomApi.ts is mocked.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { FeeStatusScreen } from '../FeeStatusScreen';
import { currentMonthString } from '../../../../lib/classroomDate';
import type { ClassFeeStatus } from '../../../../types';

const PERIOD = currentMonthString();

jest.mock('../../../../api/classroomApi', () => ({
  getFeeStatus: jest.fn(),
  setFeeAmount: jest.fn(),
}));
const { getFeeStatus, setFeeAmount } = jest.requireMock('../../../../api/classroomApi') as {
  getFeeStatus: jest.Mock;
  setFeeAmount: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <FeeStatusScreen classId="c1" />
    </ThemeProvider>
  );
}

const BOARD_RESPONSE: ClassFeeStatus = {
  period: PERIOD,
  totalStudents: 2,
  paid: 0,
  partial: 0,
  pending: 2,
  feeAmount: 500,
  totalCollected: 0,
  totalExpected: 1000,
  totalPending: 1000,
  perStudent: [
    { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'pending', amount: 0, expectedAmount: 500 },
    { studentId: 's2', name: 'Ben', rollNumber: '2', status: 'partial', amount: 200, expectedAmount: 500 },
  ],
};

describe('FeeStatusScreen', () => {
  beforeEach(() => {
    getFeeStatus.mockReset();
    setFeeAmount.mockReset();
  });

  it('shows a loading state, then the per-student list with status badges', async () => {
    let resolveLoad!: (v: ClassFeeStatus) => void;
    getFeeStatus.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading fee status…')).toBeTruthy();
    await act(async () => {
      resolveLoad(BOARD_RESPONSE);
    });

    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getByTestId('fee-status-s1').props.children).toEqual(['Pending', ' (₹500)']);
    expect(screen.getByTestId('fee-status-s2').props.children).toEqual(['Partial', ' (₹500)']);
  });

  it('the save button stays disabled until the draft amount actually changes', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    expect(screen.getByTestId('fee-save-s1').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('fee-amount-input-s1'), '500');
    expect(screen.getByTestId('fee-save-s1').props.accessibilityState?.disabled).toBe(false);

    expect(setFeeAmount).not.toHaveBeenCalled();
  });

  it('saving PATCHes the new amount and merges the derived status back in, disabling Save again', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('fee-amount-input-s1'), '500');
    setFeeAmount.mockResolvedValueOnce({
      id: 'f1', studentId: 's1', classId: 'c1', period: PERIOD, status: 'paid', amount: 500, expectedAmount: 500, updatedAt: '',
    });

    await fireEvent.press(screen.getByTestId('fee-save-s1'));

    expect(setFeeAmount).toHaveBeenCalledTimes(1);
    expect(setFeeAmount).toHaveBeenCalledWith('s1', PERIOD, 500);

    await waitFor(() => expect(screen.getByTestId('fee-status-s1').props.children).toEqual(['Paid', ' (₹500)']));
    expect(screen.getByTestId('fee-save-s1').props.accessibilityState?.disabled).toBe(true);
    // Paid count in the summary strip reflects the merge, not a re-fetch.
    expect(getFeeStatus).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error and leaves the draft untouched when the save fails', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD_RESPONSE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('fee-amount-input-s1'), '500');
    setFeeAmount.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));

    await fireEvent.press(screen.getByTestId('fee-save-s1'));

    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
    // Still pending — the failed save never touched local state.
    expect(screen.getByTestId('fee-status-s1').props.children).toEqual(['Pending', ' (₹500)']);
    expect(screen.getByTestId('fee-save-s1').props.accessibilityState?.disabled).toBe(false);
  });

  it('shows an inline error with a working retry when the initial load fails', async () => {
    getFeeStatus.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    getFeeStatus.mockResolvedValueOnce(BOARD_RESPONSE);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
  });
});
