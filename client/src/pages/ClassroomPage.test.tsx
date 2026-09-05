// Finding #6: a load failure must offer a "Try again" action that re-runs
// the same load, clears the error, and shows the successful result. The
// error/retry UI itself lives in the child ClassList component, wired to
// ClassroomPage's `load` via the `onRetry` prop.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClassroomPage from './ClassroomPage';
import { ApiError } from '../api';
import * as classroomApi from '../lib/classroomApi';
import type { SchoolClass } from '../types';

vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

vi.mock('../lib/classroomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof classroomApi>();
  return { ...actual, listClasses: vi.fn() };
});

const mockedApi = vi.mocked(classroomApi);

function schoolClass(overrides: Partial<SchoolClass> = {}): SchoolClass {
  return {
    id: 'c1', name: '7th Grade', grade: '7', section: 'A', feeAmount: 500,
    archived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/classroom']}>
      <ClassroomPage preferences={{} as never} />
    </MemoryRouter>
  );
}

describe('ClassroomPage / ClassList — load failure retry', () => {
  test('a load failure shows a "Try again" button; clicking it re-loads and clears the error on success', async () => {
    mockedApi.listClasses.mockRejectedValueOnce(new ApiError('Could not load your classes.', 500));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your classes.');
    expect(mockedApi.listClasses).toHaveBeenCalledTimes(1);

    mockedApi.listClasses.mockResolvedValueOnce([schoolClass({ name: 'Recovered Class' })]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Recovered Class')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedApi.listClasses).toHaveBeenCalledTimes(2);
  });
});
