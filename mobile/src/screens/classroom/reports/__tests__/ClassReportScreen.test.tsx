// Component tests for the Reports screen's "This Class" tab (§26 Phase 11).
// api/classroomApi.ts is mocked.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { ClassReportScreen } from '../ClassReportScreen';
import type { ClassAnalytics } from '../../../../types';

jest.mock('../../../../api/classroomApi', () => ({
  getClassAnalytics: jest.fn(),
}));
const { getClassAnalytics } = jest.requireMock('../../../../api/classroomApi') as {
  getClassAnalytics: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <ClassReportScreen classId="c1" />
    </ThemeProvider>
  );
}

const ANALYTICS: ClassAnalytics = {
  classId: 'c1',
  totalStudents: 5,
  month: { month: '2026-08', totalStudents: 5, daysMarked: 3, present: 12, absent: 2, unmarked: 1, percentage: 85.7, perStudent: [] },
  fees: { period: '2026-08', totalStudents: 5, paid: 2, partial: 1, pending: 2, totalCollected: 1100, totalExpected: 2500 },
};

describe('ClassReportScreen', () => {
  beforeEach(() => {
    getClassAnalytics.mockReset();
  });

  it('shows a loading state, then the attendance and fee summary blocks', async () => {
    let resolveLoad!: (v: ClassAnalytics) => void;
    getClassAnalytics.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading report…')).toBeTruthy();
    await act(async () => {
      resolveLoad(ANALYTICS);
    });

    await waitFor(() => expect(screen.getByText('Attendance — August 2026')).toBeTruthy());
    expect(screen.getByText('Fees — August 2026')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy(); // present
    expect(screen.getByText('85.7%')).toBeTruthy();
    expect(screen.getByText('₹1100 collected of ₹2500 expected this month.')).toBeTruthy();
  });

  it('shows an empty state when the class has no active students', async () => {
    getClassAnalytics.mockResolvedValueOnce({ ...ANALYTICS, totalStudents: 0 });
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('class-report-empty-state')).toBeTruthy());
    expect(screen.queryByText('Attendance — August 2026')).toBeNull();
  });

  it('shows an inline error with a working retry', async () => {
    getClassAnalytics.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Attendance — August 2026')).toBeTruthy());
  });
});
