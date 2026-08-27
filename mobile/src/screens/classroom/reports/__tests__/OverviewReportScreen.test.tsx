// Component tests for the Reports screen's "All Classes" tab (§26 Phase 11)
// — the first UI ever built against GET /classroom/analytics/overview.
// api/classroomApi.ts is mocked.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ApiError } from '../../../../api/client';
import { OverviewReportScreen } from '../OverviewReportScreen';
import type { TeacherAnalyticsOverview } from '../../../../types';

jest.mock('../../../../api/classroomApi', () => ({
  getTeacherAnalyticsOverview: jest.fn(),
}));
const { getTeacherAnalyticsOverview } = jest.requireMock('../../../../api/classroomApi') as {
  getTeacherAnalyticsOverview: jest.Mock;
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <OverviewReportScreen />
    </ThemeProvider>
  );
}

const OVERVIEW: TeacherAnalyticsOverview = {
  totalStudents: 12,
  today: { totalStudents: 12, present: 9, absent: 1, unmarked: 2, percentage: 90 },
  month: { month: '2026-08', totalStudents: 12, daysMarked: 4, present: 40, absent: 4, unmarked: 4, percentage: 90.9 },
  fees: { period: '2026-08', totalStudents: 12, paid: 3, partial: 3, pending: 6, totalCollected: 1650, totalExpected: 6000 },
};

describe('OverviewReportScreen', () => {
  beforeEach(() => {
    getTeacherAnalyticsOverview.mockReset();
  });

  it('shows a loading state, then today/month/fee summary blocks across every class', async () => {
    let resolveLoad!: (v: TeacherAnalyticsOverview) => void;
    getTeacherAnalyticsOverview.mockReturnValueOnce(new Promise((r) => { resolveLoad = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading overview…')).toBeTruthy();
    await act(async () => {
      resolveLoad(OVERVIEW);
    });

    await waitFor(() => expect(screen.getByText('Today — All Classes')).toBeTruthy());
    expect(screen.getByText('August 2026 — All Classes')).toBeTruthy();
    expect(screen.getByText('Fees — August 2026 — All Classes')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy(); // today's present
    expect(screen.getByText('₹1650 collected of ₹6000 expected this month.')).toBeTruthy();
  });

  it('shows an empty state when the teacher has no active students yet', async () => {
    getTeacherAnalyticsOverview.mockResolvedValueOnce({ ...OVERVIEW, totalStudents: 0 });
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('overview-report-empty-state')).toBeTruthy());
    expect(screen.queryByText('Today — All Classes')).toBeNull();
  });

  it('shows an inline error with a working retry', async () => {
    getTeacherAnalyticsOverview.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    getTeacherAnalyticsOverview.mockResolvedValueOnce(OVERVIEW);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Today — All Classes')).toBeTruthy());
  });
});
