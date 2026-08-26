// Component tests for Phase 8 Step 2's Class Home summary strip.
// api/classroomApi.ts is mocked here; a minimal local stack provides real
// navigation/route params (classId/className), matching
// ClassListScreen.test.tsx's approach.
import React from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { ClassHomeScreen } from '../ClassHomeScreen';
import type { ClassroomStackParamList } from '../../../navigation/types';
import type { AttendanceDaySummary, ClassAnalytics, SchoolClass } from '../../../types';

jest.mock('../../../api/classroomApi', () => ({
  getDailyAttendance: jest.fn(),
  getClassAnalytics: jest.fn(),
  listClasses: jest.fn(),
}));
const { getDailyAttendance, getClassAnalytics, listClasses } = jest.requireMock('../../../api/classroomApi') as {
  getDailyAttendance: jest.Mock;
  getClassAnalytics: jest.Mock;
  listClasses: jest.Mock;
};

const Stack = createNativeStackNavigator<ClassroomStackParamList>();

function renderScreen() {
  return render(
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="ClassHome">
          <Stack.Screen
            name="ClassHome"
            component={ClassHomeScreen}
            initialParams={{ classId: 'c1', className: 'Grade 6 - Section A' }}
          />
          <Stack.Screen name="Students">
            {({ route }) => <Text>Students: {route.params.className}</Text>}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

const TODAY_SUMMARY: AttendanceDaySummary = { present: 18, absent: 2, unmarked: 5, percentage: 90 };
const ANALYTICS: ClassAnalytics = {
  classId: 'c1',
  totalStudents: 25,
  month: { month: '2026-08', totalStudents: 25, daysMarked: 10, present: 200, absent: 20, unmarked: 30, percentage: 90.9, perStudent: [] },
  fees: { period: '2026-08', totalStudents: 25, paid: 10, partial: 2, pending: 13, totalCollected: 2000, totalExpected: 5000 },
};

const CLASS_A: SchoolClass = { id: 'c1', name: 'Grade 6 - Section A', grade: 'Grade 6', section: 'A', archived: false, createdAt: '', updatedAt: '' };
const CLASS_B: SchoolClass = { id: 'c2', name: 'Grade 7 - Section B', grade: 'Grade 7', section: 'B', archived: false, createdAt: '', updatedAt: '' };

const TODAY_SUMMARY_B: AttendanceDaySummary = { present: 9, absent: 1, unmarked: 0, percentage: 90 };
const ANALYTICS_B: ClassAnalytics = { ...ANALYTICS, classId: 'c2', totalStudents: 10 };

describe('ClassHomeScreen', () => {
  beforeEach(() => {
    getDailyAttendance.mockReset();
    getClassAnalytics.mockReset();
    listClasses.mockReset();
  });

  it('shows a loading state, then today\'s present/absent/unmarked summary', async () => {
    let resolveDaily!: (v: { date: string; roster: []; summary: AttendanceDaySummary }) => void;
    getDailyAttendance.mockReturnValueOnce(new Promise((r) => { resolveDaily = r; }));
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByText('Loading today’s summary…')).toBeTruthy();
    await act(async () => {
      resolveDaily({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    });

    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Today’s attendance · 25 students')).toBeTruthy();
    // Shortcut cards still render alongside the strip.
    expect(screen.getByText("Mark Today's Attendance")).toBeTruthy();
    expect(screen.getByText('Students')).toBeTruthy();
  });

  it('shows an inline error with a working retry, without hiding the shortcut cards', async () => {
    getDailyAttendance.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });

    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
    // Degrades gracefully — shortcuts are still usable even if the strip failed.
    expect(screen.getByText("Mark Today's Attendance")).toBeTruthy();

    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());
  });

  it('navigates to Students with the class id/name when its shortcut is pressed', async () => {
    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());

    await fireEvent.press(screen.getByText('Students'));
    expect(screen.getByText('Students: Grade 6 - Section A')).toBeTruthy();
  });

  it('opens the class switcher and lists active classes, with the current one marked', async () => {
    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());

    listClasses.mockResolvedValueOnce([CLASS_A, CLASS_B]);
    await fireEvent.press(screen.getByTestId('classhome-switcher-trigger'));

    await waitFor(() => expect(screen.getByTestId('class-switcher-list')).toBeTruthy());
    expect(listClasses).toHaveBeenCalledWith();
    const currentRow = screen.getByLabelText('Grade 6 - Section A');
    expect(currentRow.props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Grade 7 - Section B')).toBeTruthy();
  });

  it('switching to a different class reloads Class Home scoped to the new class', async () => {
    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());

    listClasses.mockResolvedValueOnce([CLASS_A, CLASS_B]);
    await fireEvent.press(screen.getByTestId('classhome-switcher-trigger'));
    await waitFor(() => expect(screen.getByLabelText('Grade 7 - Section B')).toBeTruthy());

    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY_B });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS_B);
    await fireEvent.press(screen.getByLabelText('Grade 7 - Section B'));

    // Scoped to c2 now — the daily-attendance/analytics calls after the
    // switch use the new class's id, and the strip/shortcuts re-render with
    // its data, not a stale mix of the two classes'.
    await waitFor(() => expect(getDailyAttendance).toHaveBeenLastCalledWith('c2', expect.any(String)));
    expect(getClassAnalytics).toHaveBeenLastCalledWith('c2');
    await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
    expect(screen.getByText('Today’s attendance · 10 students')).toBeTruthy();
    // The sheet closed and the header now reads the new class's name.
    expect(screen.queryByTestId('class-switcher-list')).toBeNull();
    expect(screen.getByLabelText('Grade 7 - Section B. Switch class.')).toBeTruthy();
  });

  it('selecting the already-current class in the switcher is a no-op', async () => {
    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());

    listClasses.mockResolvedValueOnce([CLASS_A, CLASS_B]);
    await fireEvent.press(screen.getByTestId('classhome-switcher-trigger'));
    await waitFor(() => expect(screen.getByLabelText('Grade 6 - Section A')).toBeTruthy());

    getDailyAttendance.mockClear();
    getClassAnalytics.mockClear();
    await fireEvent.press(screen.getByLabelText('Grade 6 - Section A'));

    expect(getDailyAttendance).not.toHaveBeenCalled();
    expect(getClassAnalytics).not.toHaveBeenCalled();
  });

  it('shows a switcher error with a working retry', async () => {
    getDailyAttendance.mockResolvedValueOnce({ date: '2026-08-26', roster: [], summary: TODAY_SUMMARY });
    getClassAnalytics.mockResolvedValueOnce(ANALYTICS);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('18')).toBeTruthy());

    listClasses.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await fireEvent.press(screen.getByTestId('classhome-switcher-trigger'));
    await waitFor(() => expect(screen.getAllByText('Could not reach the server.').length).toBeGreaterThan(0));

    listClasses.mockResolvedValueOnce([CLASS_A]);
    await fireEvent.press(screen.getAllByText('Retry')[screen.getAllByText('Retry').length - 1]);
    await waitFor(() => expect(screen.getByTestId('class-switcher-list')).toBeTruthy());
  });
});
