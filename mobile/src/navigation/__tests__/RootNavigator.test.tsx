// Navigation-tree smoke test (docs/mobile-app-plan.md §23, §26 Phase 2):
// the 5-tab bottom nav matches §10, and the role-gating stub actually hides
// Admin for a mocked teacher role — the two things Phase 2's acceptance
// criteria call out explicitly.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { MockRoleProvider } from '../../auth/MockRoleContext';
import { RootNavigator } from '../RootNavigator';

// render() is async in this version of @testing-library/react-native
// (React 19's concurrent rendering) — every call site must await it before
// `screen` reflects the render result.
async function renderApp() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <MockRoleProvider>
          <RootNavigator />
        </MockRoleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// React Navigation's bottom-tab buttons render with role="button" and an
// accessibilityLabel of the form "<Label>, tab, <n> of 5" — not role="tab".
function tabButton(label: string) {
  return screen.getByRole('button', { name: new RegExp(`^${label}, tab,`) });
}

describe('RootNavigator', () => {
  it('renders all 5 bottom tabs from §10, with Coach as the default screen', async () => {
    await renderApp();
    expect(tabButton('Coach')).toBeTruthy();
    expect(tabButton('Classroom')).toBeTruthy();
    expect(tabButton('Library')).toBeTruthy();
    expect(tabButton('Generator')).toBeTruthy();
    expect(tabButton('More')).toBeTruthy();
    // Coach is the default tab, matching '/' being the default web route.
    expect(screen.getByText('Chat UI over POST /api/coach — Phase 4.')).toBeTruthy();
  });

  it('hides Admin from the More menu for a mocked teacher role', async () => {
    await renderApp();
    await fireEvent.press(tabButton('More'));
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows Admin in the More menu once the mocked role is switched to an admin role', async () => {
    await renderApp();
    await fireEvent.press(tabButton('More'));
    await fireEvent.press(screen.getByText('school_admin'));
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('navigates from Classroom -> Class List -> Class Home -> Attendance, matching the pushed-stack pattern (§12)', async () => {
    await renderApp();
    await fireEvent.press(tabButton('Classroom'));
    expect(screen.getByText('Grade 6 - Section A')).toBeTruthy();

    await fireEvent.press(screen.getByText('Grade 6 - Section A'));
    expect(screen.getByText("Mark Today's Attendance")).toBeTruthy();

    await fireEvent.press(screen.getByText("Mark Today's Attendance"));
    expect(screen.getByText('Mark + Monthly Summary — Phase 9.')).toBeTruthy();
  });
});
