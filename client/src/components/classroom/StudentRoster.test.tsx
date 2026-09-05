// Finding #6: a load failure must offer a "Try again" action that re-runs
// the same load, clears the error, and shows the successful result.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudentRoster from './StudentRoster';
import { ApiError } from '../../api';
import * as classroomApi from '../../lib/classroomApi';
import type { Student } from '../../types';

vi.mock('../Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

vi.mock('../../lib/classroomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof classroomApi>();
  return { ...actual, listStudents: vi.fn() };
});

const mockedApi = vi.mocked(classroomApi);

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 's1', classId: 'c1', name: 'Asha Verma', rollNumber: '12',
    active: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('StudentRoster — load failure retry', () => {
  test('a load failure shows a "Try again" button; clicking it re-loads and clears the error on success', async () => {
    mockedApi.listStudents.mockRejectedValueOnce(new ApiError('Could not load students.', 500));
    render(<StudentRoster classId="c1" className="7th Grade" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load students.');
    expect(mockedApi.listStudents).toHaveBeenCalledTimes(1);

    mockedApi.listStudents.mockResolvedValueOnce([student()]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Asha Verma')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedApi.listStudents).toHaveBeenCalledTimes(2);
  });
});
