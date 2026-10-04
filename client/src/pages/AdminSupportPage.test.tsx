// A stats-load failure must offer a "Try again" action that re-runs just that fetch, independent of the ticket table.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminSupportPage from './AdminSupportPage';
import { usePreferences } from '../hooks/usePreferences';
import * as apiModule from '../api';

vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/AdminTabs', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(apiModule.api);

function mockApiByPath(stats: unknown) {
  mockedApi.mockImplementation((path: string) => {
    if (path === '/admin/support/tickets/stats') {
      return stats instanceof Error ? Promise.reject(stats) : Promise.resolve(stats);
    }
    if (path.startsWith('/admin/schools')) return Promise.resolve({ schools: [], total: 0 });
    if (path.startsWith('/admin/support/tickets')) return Promise.resolve({ tickets: [], total: 0 });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/support']}>
      <AdminSupportPage preferences={{} as ReturnType<typeof usePreferences>} />
    </MemoryRouter>
  );
}

describe('AdminSupportPage — stats load failure retry', () => {
  test('a stats load failure shows a "Try again" action; clicking it re-loads and shows the stats on success', async () => {
    mockApiByPath(new Error('network'));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load ticket stats.');

    mockApiByPath({ open: 4, today: 1, bugs: 3, feedback: 1 });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
