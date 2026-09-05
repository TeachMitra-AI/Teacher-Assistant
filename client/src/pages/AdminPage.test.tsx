// Finding #6: a load failure must offer a "Try again" action that re-runs
// the same load, clears the error, and shows the successful result.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';
import { ApiError } from '../api';
import * as apiModule from '../api';
import type { Analytics } from '../types';

vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/AdminTabs', () => ({ default: () => null }));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(apiModule.api);

function analytics(overrides: Partial<Analytics> = {}): Analytics {
  return {
    totals: { queries: 3, teachers: 2, activeTeachers: 1, feedback: 0, helpfulRatio: 0 },
    bySubject: [], byIssueType: [], byLanguage: [], byDay: [], topQuestions: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminPage preferences={{} as never} />
    </MemoryRouter>
  );
}

describe('AdminPage — load failure retry', () => {
  test('a load failure shows a "Try again" button; clicking it re-loads and clears the error on success', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('Failed to load analytics', 500));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load analytics');
    expect(mockedApi).toHaveBeenCalledTimes(1);

    mockedApi.mockResolvedValueOnce(analytics({ totals: { queries: 42, teachers: 5, activeTeachers: 3, feedback: 1, helpfulRatio: 80 } }));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledTimes(2);
  });
});
