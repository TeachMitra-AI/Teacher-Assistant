// Component tests for the Phase 8 Step 3 Students list + Add/Edit sheet
// (replaces the Phase 2 PlaceholderScreen). api/classroomApi.ts is mocked.
// The "+ Add student" control lives in the native-stack header (set via
// navigation.setOptions({ headerRight })) — following ResourceEditScreen.test.tsx's
// established pattern, it's rendered with a mocked `navigation` object (no
// real Stack.Navigator) and its onPress is invoked directly off the most
// recent setOptions call, rather than mounting a second render tree for it.
// The Add/Edit sheet itself IS part of the main render tree (an inline
// Modal), so it's driven with normal fireEvent.press.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { StudentsScreen } from '../StudentsScreen';
import type { Student } from '../../../types';

jest.mock('../../../api/classroomApi', () => ({
  listStudents: jest.fn(),
  addStudent: jest.fn(),
  updateStudent: jest.fn(),
}));
const { listStudents, addStudent, updateStudent } = jest.requireMock('../../../api/classroomApi') as {
  listStudents: jest.Mock;
  addStudent: jest.Mock;
  updateStudent: jest.Mock;
};

function makeNavigation() {
  return { setOptions: jest.fn() };
}

async function renderScreen(navigation = makeNavigation()) {
  await render(
    <ThemeProvider>
      <StudentsScreen
        navigation={navigation as never}
        route={{ key: 'r', name: 'Students', params: { classId: 'c1', className: 'Grade 6 - Section A' } } as never}
      />
    </ThemeProvider>
  );
  return navigation;
}

function pressAddButton(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  const headerElement = last.headerRight();
  return act(async () => headerElement.props.onPress());
}

const ASHA: Student = { id: 's1', classId: 'c1', name: 'Asha Verma', rollNumber: '12', active: true, createdAt: '', updatedAt: '' };
const RAVI: Student = { id: 's2', classId: 'c1', name: 'Ravi Kumar', rollNumber: null, active: true, createdAt: '', updatedAt: '' };

describe('StudentsScreen', () => {
  beforeEach(() => {
    listStudents.mockReset();
    addStudent.mockReset();
    updateStudent.mockReset();
  });

  it('shows a loading state, then the fetched roster', async () => {
    let resolve!: (v: Student[]) => void;
    listStudents.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await act(async () => {
      await renderScreen();
    });

    expect(screen.getByText('Loading students…')).toBeTruthy();
    await act(async () => {
      resolve([ASHA, RAVI]);
    });

    await waitFor(() => expect(screen.getByText('Asha Verma')).toBeTruthy());
    expect(screen.getByText('Roll no. 12')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('No roll number')).toBeTruthy();
    expect(listStudents).toHaveBeenCalledWith('c1');
  });

  it('shows the empty state when the class has no students', async () => {
    listStudents.mockResolvedValueOnce([]);
    await act(async () => {
      await renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('students-empty-state')).toBeTruthy());
    expect(screen.getByText('No students yet')).toBeTruthy();
  });

  it('shows the server error message with a working retry', async () => {
    listStudents.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      await renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());

    listStudents.mockResolvedValueOnce([ASHA]);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Asha Verma')).toBeTruthy());
  });

  it('adds a student via the header Add button and shows it in the list', async () => {
    listStudents.mockResolvedValueOnce([ASHA]);
    const navigation = await renderScreen();
    await waitFor(() => expect(screen.getByText('Asha Verma')).toBeTruthy());

    await pressAddButton(navigation);
    expect(screen.getByText('Add student')).toBeTruthy();

    const created: Student = { id: 's3', classId: 'c1', name: 'Bala Singh', rollNumber: '5', active: true, createdAt: '', updatedAt: '' };
    addStudent.mockResolvedValueOnce(created);

    await fireEvent.changeText(screen.getByTestId('student-form-name'), 'Bala Singh');
    await fireEvent.changeText(screen.getByTestId('student-form-roll-number'), '5');
    await fireEvent.press(screen.getByText('Add'));

    await waitFor(() => expect(addStudent).toHaveBeenCalledWith('c1', { name: 'Bala Singh', rollNumber: '5' }));
    await waitFor(() => expect(screen.getByText('Bala Singh')).toBeTruthy());
    // Modal closed on success.
    expect(screen.queryByText('Add student')).toBeNull();
  });

  it('does not submit the add form while the name is blank', async () => {
    listStudents.mockResolvedValueOnce([]);
    const navigation = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('students-empty-state')).toBeTruthy());

    await pressAddButton(navigation);
    await fireEvent.press(screen.getByText('Add'));

    expect(addStudent).not.toHaveBeenCalled();
  });

  it('shows an inline error and keeps the sheet open when adding fails', async () => {
    listStudents.mockResolvedValueOnce([]);
    const navigation = await renderScreen();
    await waitFor(() => expect(screen.getByTestId('students-empty-state')).toBeTruthy());

    await pressAddButton(navigation);
    addStudent.mockRejectedValueOnce(new ApiError('A student with that roll number already exists.', 400));
    await fireEvent.changeText(screen.getByTestId('student-form-name'), 'Bala Singh');
    await fireEvent.press(screen.getByText('Add'));

    await waitFor(() => expect(screen.getByText('A student with that roll number already exists.')).toBeTruthy());
    expect(screen.getByText('Add student')).toBeTruthy();
  });

  it('edits a student via its row Edit button, prefilled with the existing values', async () => {
    listStudents.mockResolvedValueOnce([ASHA]);
    await act(async () => {
      await renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Asha Verma')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Edit Asha Verma'));
    expect(screen.getByText('Edit Asha Verma')).toBeTruthy();
    expect(screen.getByTestId('student-form-name').props.value).toBe('Asha Verma');
    expect(screen.getByTestId('student-form-roll-number').props.value).toBe('12');

    const updated: Student = { ...ASHA, name: 'Asha V. Verma' };
    updateStudent.mockResolvedValueOnce(updated);
    await fireEvent.changeText(screen.getByTestId('student-form-name'), 'Asha V. Verma');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(updateStudent).toHaveBeenCalledWith('s1', { name: 'Asha V. Verma', rollNumber: '12' }));
    await waitFor(() => expect(screen.getByText('Asha V. Verma')).toBeTruthy());
  });
});
