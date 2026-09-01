// Component tests for the Reports screen (native port of client/src/
// components/classroom/ReportsPanel.tsx). api/classroomApi.ts is mocked.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { ReportsScreen } from '../ReportsScreen';
import { currentMonthString } from '../../../../lib/classroomDate';
import type { ClassFeeStatus } from '../../../../types';

const PERIOD = currentMonthString();

jest.mock('../../../../api/classroomApi', () => ({
  getFeeStatus: jest.fn(),
  downloadFeesReport: jest.fn(),
}));
const { getFeeStatus, downloadFeesReport } = jest.requireMock('../../../../api/classroomApi') as {
  getFeeStatus: jest.Mock;
  downloadFeesReport: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <ReportsScreen route={{ key: 'r', name: 'Reports', params: { classId: 'c1', className: 'Grade 6 - A' } } as never} navigation={{} as never} />
    </ThemeProvider>
  );
}

const BOARD: ClassFeeStatus = {
  period: PERIOD,
  totalStudents: 3,
  paid: 1,
  partial: 1,
  pending: 1,
  feeAmount: 500,
  totalCollected: 600,
  totalExpected: 1500,
  totalPending: 900,
  perStudent: [
    { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'paid', amount: 500, expectedAmount: 500 },
    { studentId: 's2', name: 'Ben', rollNumber: '2', status: 'partial', amount: 100, expectedAmount: 500 },
    { studentId: 's3', name: 'Chetan', rollNumber: '10', status: 'pending', amount: 0, expectedAmount: 500 },
  ],
};

describe('ReportsScreen', () => {
  beforeEach(() => {
    getFeeStatus.mockReset();
    downloadFeesReport.mockReset();
  });

  it('shows a loading state, then the fee summary tiles', async () => {
    let resolve!: (v: ClassFeeStatus) => void;
    getFeeStatus.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await act(async () => { renderScreen(); });

    expect(screen.getByText('Loading report…')).toBeTruthy();
    await act(async () => { resolve(BOARD); });

    await waitFor(() => expect(screen.getByText('₹1500')).toBeTruthy());
    expect(screen.getByText('₹600')).toBeTruthy();
    expect(screen.getByText('₹900')).toBeTruthy();
    expect(getFeeStatus).toHaveBeenCalledWith('c1', PERIOD);
  });

  it('shows the server error message with a working retry', async () => {
    getFeeStatus.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    getFeeStatus.mockResolvedValueOnce(BOARD);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('₹1500')).toBeTruthy());
  });

  it('lists students who still owe money, sorted by roll number, and excludes fully paid students', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByTestId('reports-owing-list')).toBeTruthy());

    // Ben (roll 2) owes, Chetan (roll 10) owes — Asha (paid) does not appear here.
    const list = screen.getByTestId('reports-owing-list');
    expect(list).toBeTruthy();
    expect(screen.getAllByText('Ben').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chetan').length).toBeGreaterThan(0);
  });

  it('shows the empty state when nobody owes money', async () => {
    getFeeStatus.mockResolvedValueOnce({ ...BOARD, perStudent: BOARD.perStudent.map((s) => ({ ...s, status: 'paid' as const })) });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByTestId('reports-empty-state')).toBeTruthy());
    expect(screen.getByText("Everyone's paid up")).toBeTruthy();
  });

  it('tapping a filter tile opens the drill-down modal with the matching students, and tapping it again closes it', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByLabelText('Show paid students')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Show paid students'));
    await waitFor(() => expect(screen.getByTestId('fee-status-modal-list')).toBeTruthy());
    expect(screen.getByText(/Students marked paid/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Show paid students'));
    await waitFor(() => expect(screen.queryByTestId('fee-status-modal-list')).toBeNull());
  });

  it('switching directly from one filter tile to another shows the new category', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByLabelText('Show paid students')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Show paid students'));
    await waitFor(() => expect(screen.getByText(/Students marked paid/)).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Show pending students'));
    await waitFor(() => expect(screen.getByText(/Students marked pending/)).toBeTruthy());
  });

  it('the download button calls downloadFeesReport for the current period', async () => {
    getFeeStatus.mockResolvedValueOnce(BOARD);
    downloadFeesReport.mockResolvedValueOnce(undefined);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByTestId('reports-download')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('reports-download'));
    await waitFor(() => expect(downloadFeesReport).toHaveBeenCalledWith('c1', PERIOD));
  });
});
