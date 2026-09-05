// Finding #6: a load failure must offer a "Try again" action that re-runs
// the same load, clears the error, and shows the successful result — not
// just a static message with no way forward short of a full page reload.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LibraryPage from './LibraryPage';
import { ApiError } from '../api';
import * as resourcesLib from '../lib/resources';

vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 't@example.com', role: 'teacher',
      school: { id: 's1', name: 'Test School', code: 'TS01' },
      // Dismissed so the onboarding tip banner doesn't add noise to this test.
      preferences: { onboarding: { dismissedTips: ['library-intro'] } },
    },
    updateUser: vi.fn(),
  }),
}));

vi.mock('../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof resourcesLib>();
  return { ...actual, listResources: vi.fn(), deleteResource: vi.fn() };
});

const mockedResources = vi.mocked(resourcesLib);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/library']}>
      <LibraryPage preferences={{} as never} />
    </MemoryRouter>
  );
}

describe('LibraryPage — load failure retry', () => {
  test('a load failure shows a "Try again" button; clicking it re-loads and clears the error on success', async () => {
    mockedResources.listResources.mockRejectedValueOnce(new ApiError('Could not load your library.', 500));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your library.');
    expect(mockedResources.listResources).toHaveBeenCalledTimes(1);

    mockedResources.listResources.mockResolvedValueOnce([
      { id: 'r1', type: 'lesson_plan', title: 'Fractions', grade: '', subject: '', updatedAt: new Date().toISOString(), content: '', sourceQueryId: null } as never,
    ]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Fractions')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedResources.listResources).toHaveBeenCalledTimes(2);
  });

  test('a second load failure after Retry shows the error again, without a duplicate request', async () => {
    mockedResources.listResources.mockRejectedValueOnce(new ApiError('Could not load your library.', 500));
    renderPage();
    await screen.findByRole('alert');

    mockedResources.listResources.mockRejectedValueOnce(new ApiError('The service is temporarily unavailable. Please try again in a moment.', 503));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('The service is temporarily unavailable. Please try again in a moment.')).toBeInTheDocument();
    expect(mockedResources.listResources).toHaveBeenCalledTimes(2);
  });
});
