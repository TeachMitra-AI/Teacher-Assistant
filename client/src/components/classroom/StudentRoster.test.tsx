// A load failure must offer a "Try again" action that re-runs the load, clears the error and shows the result.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudentRoster from './StudentRoster';
import { ApiError } from '../../api';
import * as classroomApi from '../../lib/classroomApi';
import type { Student } from '../../types';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../../lib/classroomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof classroomApi>();
  return { ...actual, listStudents: vi.fn(), addStudent: vi.fn() };
});

const mockedApi = vi.mocked(classroomApi);

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 's1', classId: 'c1', name: 'Asha Verma', rollNumber: '12',
    active: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  };
}

function rosterNames() {
  return screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
}

describe('StudentRoster — roll-number order', () => {
  test('shows students in numeric order, and a new student lands in position without a reload', async () => {
    mockedApi.listStudents.mockResolvedValueOnce([
      student({ id: 's10', name: 'Ten', rollNumber: '10' }),
      student({ id: 's2', name: 'Two', rollNumber: '2' }),
    ]);
    mockedApi.addStudent.mockResolvedValueOnce(student({ id: 's3', name: 'Three', rollNumber: '3' }));
    render(<StudentRoster classId="c1" className="7th Grade" />);

    await screen.findByText('Ten');
    expect(rosterNames()).toEqual(['Two', 'Ten']);
    const loadsBefore = mockedApi.listStudents.mock.calls.length;

    await userEvent.type(screen.getByLabelText('New student name'), 'Three');
    await userEvent.type(screen.getByLabelText('New student roll number'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add student' }));

    await screen.findByText('Three');
    expect(rosterNames()).toEqual(['Two', 'Three', 'Ten']);
    expect(mockedApi.listStudents).toHaveBeenCalledTimes(loadsBefore);
  });

  test('a duplicate rejected by the server shows its message and keeps what the teacher typed', async () => {
    mockedApi.listStudents.mockResolvedValueOnce([student({ id: 's2', name: 'Two', rollNumber: '2' })]);
    mockedApi.addStudent.mockRejectedValueOnce(new ApiError('Roll number 2 is already used in this class.', 409));
    render(<StudentRoster classId="c1" className="7th Grade" />);

    await screen.findByText('Two');
    await userEvent.type(screen.getByLabelText('New student name'), 'Copy');
    await userEvent.type(screen.getByLabelText('New student roll number'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add student' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Roll number 2 is already used in this class.', 'error'));
    expect(rosterNames()).toEqual(['Two']);
    expect(screen.getByLabelText('New student name')).toHaveValue('Copy');
  });
});

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
