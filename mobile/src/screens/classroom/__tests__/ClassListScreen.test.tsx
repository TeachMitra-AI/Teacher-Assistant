// Component tests for the Phase 8 Class List: Step 1's real list, plus Step
// 4's create/archive/restore + "Show archived classes" toggle. api/classroomApi.ts
// is mocked here; a minimal local stack (not the full ClassroomStack, which
// pulls in Header's auth/notification dependencies) provides real navigation
// so pressing a row can be asserted against a genuine screen transition.
import React from 'react';
import { Text, Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { ClassListScreen } from '../ClassListScreen';
import type { ClassroomStackParamList } from '../../../navigation/types';
import type { SchoolClass } from '../../../types';

jest.mock('../../../api/classroomApi', () => ({
  listClasses: jest.fn(),
  createClass: jest.fn(),
  updateClass: jest.fn(),
  archiveClass: jest.fn(),
}));
const { listClasses, createClass, updateClass, archiveClass } = jest.requireMock('../../../api/classroomApi') as {
  listClasses: jest.Mock;
  createClass: jest.Mock;
  updateClass: jest.Mock;
  archiveClass: jest.Mock;
};

const Stack = createNativeStackNavigator<ClassroomStackParamList>();

function renderScreen() {
  return render(
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="ClassList" component={ClassListScreen} />
          <Stack.Screen name="ClassHome">
            {({ route }) => <Text>Class Home: {route.params.className}</Text>}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

const CLASS_A: SchoolClass = {
  id: 'c1',
  name: 'Grade 6 - Section A',
  grade: 'Grade 6',
  section: 'A',
  feeAmount: 200,
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CLASS_ARCHIVED: SchoolClass = {
  id: 'c2',
  name: 'Old Batch',
  grade: null,
  section: null,
  archived: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};

async function pressAddClass() {
  await fireEvent.press(screen.getByTestId('classlist-add-button'));
}

describe('ClassListScreen', () => {
  beforeEach(() => {
    listClasses.mockReset();
    createClass.mockReset();
    updateClass.mockReset();
    archiveClass.mockReset();
  });

  // jest.spyOn(Alert, 'alert') reconfigures the SAME underlying mock across
  // tests rather than creating a fresh one each time — without restoring it,
  // a later test's alertSpy.mock.calls/not.toHaveBeenCalled() assertions
  // would see leftover invocations from earlier tests in this file.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a loading state, then the fetched classes', async () => {
    let resolve!: (value: SchoolClass[]) => void;
    // The screen reloads on the navigator's initial 'focus' event as well as
    // on mount (ClassListScreen.tsx) — return the same pending promise for
    // every call so both resolve together.
    listClasses.mockReturnValue(new Promise((r) => { resolve = r; }));
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading your classes…')).toBeTruthy();
    await act(async () => {
      resolve([CLASS_A]);
    });

    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());
    expect(screen.getByText('Grade 6 · A · ₹200/month')).toBeTruthy();
    // Always fetches WITH archived included (Step 4: the toggle filters
    // client-side, no re-fetch per flip).
    expect(listClasses).toHaveBeenCalledWith(true);
  });

  it('shows the empty state when the teacher has no classes', async () => {
    listClasses.mockResolvedValue([]);
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByTestId('classroom-empty-state')).toBeTruthy());
    expect(screen.getByText('No classes yet')).toBeTruthy();
  });

  it('shows the server error message on failure', async () => {
    listClasses.mockRejectedValue(new ApiError('Could not reach the server.', 0));
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
  });

  it('navigates to Class Home when a class row is pressed', async () => {
    listClasses.mockResolvedValue([CLASS_A]);
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());
    await fireEvent.press(screen.getByText('Grade 6 - Section A'));

    expect(screen.getByText('Class Home: Grade 6 - Section A')).toBeTruthy();
  });

  it('archived classes stay hidden until "Show archived classes" is switched on', async () => {
    listClasses.mockResolvedValue([CLASS_A, CLASS_ARCHIVED]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    expect(screen.queryByText('Old Batch')).toBeNull();
    // Mount + the navigator's initial 'focus' event both fetch once each
    // (Step 1's own already-documented double-fetch-on-mount pattern) —
    // capture that baseline, then confirm flipping the toggle adds no more.
    const callsBeforeToggle = listClasses.mock.calls.length;
    await fireEvent(screen.getByTestId('archived-toggle-switch'), 'valueChange', true);
    expect(screen.getByText('Old Batch')).toBeTruthy();
    // Filtering is client-side — no additional fetch from flipping the toggle.
    expect(listClasses.mock.calls.length).toBe(callsBeforeToggle);
  });

  it('creates a class via the header Add button and shows it in the list', async () => {
    listClasses.mockResolvedValue([CLASS_A]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    await pressAddClass();
    expect(screen.getByTestId('class-form-name')).toBeTruthy();

    const created: SchoolClass = { id: 'c3', name: 'Class 8-C', grade: 'Class 8', section: 'C', archived: false, createdAt: '', updatedAt: '' };
    createClass.mockResolvedValueOnce(created);

    await fireEvent.changeText(screen.getByTestId('class-form-name'), 'Class 8-C');
    await fireEvent.changeText(screen.getByTestId('class-form-grade'), 'Class 8');
    await fireEvent.changeText(screen.getByTestId('class-form-section'), 'C');
    await fireEvent.press(screen.getByText('Add'));

    await waitFor(() =>
      expect(createClass).toHaveBeenCalledWith({ name: 'Class 8-C', grade: 'Class 8', section: 'C' })
    );
    await waitFor(() => expect(screen.getByText('Class 8-C')).toBeTruthy());
    // Sheet closed on success — the trigger button's own "Add class" label
    // is still on screen, but the form field is gone.
    expect(screen.queryByTestId('class-form-name')).toBeNull();
  });

  it('does not submit the create form while the name is blank', async () => {
    listClasses.mockResolvedValue([]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByTestId('classroom-empty-state')).toBeTruthy());

    await pressAddClass();
    await fireEvent.press(screen.getByText('Add'));

    expect(createClass).not.toHaveBeenCalled();
  });

  it('preserves entered form data and shows an inline error when creation fails', async () => {
    listClasses.mockResolvedValue([]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByTestId('classroom-empty-state')).toBeTruthy());

    await pressAddClass();
    createClass.mockRejectedValueOnce(new ApiError('A class with that name already exists.', 400));
    await fireEvent.changeText(screen.getByTestId('class-form-name'), 'Class 8-C');
    await fireEvent.press(screen.getByText('Add'));

    await waitFor(() => expect(screen.getByText('A class with that name already exists.')).toBeTruthy());
    // Sheet stayed open with the entered name intact — nothing was lost.
    expect(screen.getByTestId('class-form-name')).toBeTruthy();
    expect(screen.getByTestId('class-form-name').props.value).toBe('Class 8-C');
  });

  it('archives a class after confirming, and it drops out of the active view', async () => {
    listClasses.mockResolvedValue([CLASS_A]);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    archiveClass.mockResolvedValueOnce({ ...CLASS_A, archived: true });
    await fireEvent.press(screen.getByLabelText('Archive Grade 6 - Section A'));

    await waitFor(() => expect(archiveClass).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText('Grade 6 - Section A')).toBeNull());

    // Still there under "Show archived classes", now marked as archived.
    await fireEvent(screen.getByTestId('archived-toggle-switch'), 'valueChange', true);
    expect(screen.getByText(/Archived/)).toBeTruthy();
  });

  it('does not archive when the confirmation is cancelled', async () => {
    listClasses.mockResolvedValue([CLASS_A]);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Archive Grade 6 - Section A'));

    expect(archiveClass).not.toHaveBeenCalled();
    expect(screen.getByText('Grade 6 - Section A')).toBeTruthy();
  });

  it('restores an archived class without a confirmation prompt', async () => {
    listClasses.mockResolvedValue([CLASS_ARCHIVED]);
    const alertSpy = jest.spyOn(Alert, 'alert');
    await act(async () => {
      renderScreen();
    });
    await fireEvent(screen.getByTestId('archived-toggle-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByText('Old Batch')).toBeTruthy());

    updateClass.mockResolvedValueOnce({ ...CLASS_ARCHIVED, archived: false });
    await fireEvent.press(screen.getByLabelText('Restore Old Batch'));

    await waitFor(() => expect(updateClass).toHaveBeenCalledWith('c2', { archived: false }));
    expect(alertSpy).not.toHaveBeenCalled();
    // Toggle is still on, so the now-active class stays visible, no longer
    // tagged "Archived".
    await waitFor(() => expect(screen.queryByText(/Archived/)).toBeNull());
  });

  it('shows an inline error if archiving fails', async () => {
    listClasses.mockResolvedValue([CLASS_A]);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    archiveClass.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await fireEvent.press(screen.getByLabelText('Archive Grade 6 - Section A'));

    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
    // Unchanged — still active, still visible.
    expect(screen.getByText('Grade 6 - Section A')).toBeTruthy();
  });
});
