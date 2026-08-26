// Component tests for the Admin Analytics / Usage Dashboard screen
// (docs/mobile-app-plan.md's Phase 7c "Newly approved features"). api/admin.ts
// is mocked here — its own request shape is covered by api/__tests__/admin.test.ts.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { AdminAnalyticsScreen } from '../AdminAnalyticsScreen';

jest.mock('../../../api/admin', () => ({ getAnalytics: jest.fn() }));
const { getAnalytics } = jest.requireMock('../../../api/admin') as { getAnalytics: jest.Mock };

const ANALYTICS = {
  totals: { queries: 42, teachers: 7, activeTeachers: 3, feedback: 5, helpfulRatio: 80 },
  bySubject: [{ label: 'Science', count: 10 }, { label: 'Maths', count: 4 }],
  byIssueType: [{ label: 'Lesson plan', count: 6 }],
  byLanguage: [{ label: 'English', count: 12 }],
  byDay: [{ date: '2026-08-20', count: 3 }, { date: '2026-08-21', count: 5 }],
  topQuestions: [{ question: 'How do I teach fractions?', count: 4 }],
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <AdminAnalyticsScreen />
    </ThemeProvider>
  );
}

describe('AdminAnalyticsScreen', () => {
  beforeEach(() => {
    getAnalytics.mockReset();
  });

  it('shows a loading state, then the fetched totals', async () => {
    let resolve!: (value: typeof ANALYTICS) => void;
    getAnalytics.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading analytics…')).toBeTruthy();
    await act(async () => {
      resolve(ANALYTICS);
    });
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(screen.getByText('Usage dashboard')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('Science')).toBeTruthy();
    expect(screen.getByText('How do I teach fractions?')).toBeTruthy();
  });

  it('shows the server error message on failure', async () => {
    getAnalytics.mockRejectedValueOnce(new ApiError('Admins only.', 403));
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByText('Admins only.')).toBeTruthy());
  });
});
