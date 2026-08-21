// Navigation-tree tests (docs/mobile-app-plan.md §23, §26 Phase 3):
// unauthenticated vs authenticated navigation, and role-based Admin
// visibility driven by the REAL signed-in user now that AuthContext has
// replaced Phase 2's MockRoleContext stub. The Classroom nested-stack test
// carried over from Phase 2 now runs against an authenticated session, since
// MainTabs is unreachable without one.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { AuthProvider } from '../../auth/AuthContext';
import { setSession } from '../../api/session';
import { RootNavigator } from '../RootNavigator';
import type { Role } from '../../types';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.has(key) ? (store.get(key) as string) : null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockUser(role: Role) {
  return {
    id: 'u1',
    name: 'Asha Verma',
    email: 'asha@example.com',
    role,
    preferences: {},
    school: { id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' },
  };
}

async function renderApp() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Signs the AuthProvider in before rendering, so tests that need the
// authenticated tree don't have to drive the login form.
async function signInAsRole(role: Role) {
  await setSession('valid-token', 'valid-refresh');
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
    jsonResponse(200, { user: mockUser(role), featureFlags: { learningRepresentationEnabled: false } })
  );
}

function tabButton(label: string) {
  return screen.getByRole('button', { name: new RegExp(`^${label}, tab,`) });
}

describe('RootNavigator', () => {
  beforeEach(async () => {
    await setSession(null, null);
    globalThis.fetch = jest.fn();
  });

  it('shows the sign-in screen, not the tab bar, when there is no stored session', async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByTestId('authSubmitButton')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Coach, tab,/ })).toBeNull();
  });

  it('restores an authenticated session on launch and shows the 5-tab bar', async () => {
    await signInAsRole('teacher');
    await renderApp();

    await waitFor(() => expect(tabButton('Coach')).toBeTruthy());
    expect(tabButton('Classroom')).toBeTruthy();
    expect(tabButton('Library')).toBeTruthy();
    expect(tabButton('Generator')).toBeTruthy();
    expect(tabButton('More')).toBeTruthy();
    // Coach is the default/first tab (§10) — its own chat screen (Phase 4)
    // renders immediately, not a placeholder, confirming the authenticated
    // session flows all the way through to the actual Coach UI rather than
    // just an empty tab bar.
    expect(screen.getByText('Hi Asha Verma 👋')).toBeTruthy();
    expect(screen.getByTestId('coach-composer-input')).toBeTruthy();
  });

  it('hides Admin from the More menu for a teacher', async () => {
    await signInAsRole('teacher');
    await renderApp();
    await waitFor(() => expect(tabButton('More')).toBeTruthy());

    await fireEvent.press(tabButton('More'));
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows Admin in the More menu for a school_admin', async () => {
    await signInAsRole('school_admin');
    await renderApp();
    await waitFor(() => expect(tabButton('More')).toBeTruthy());

    await fireEvent.press(tabButton('More'));
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('signing out from the More menu returns to the sign-in screen', async () => {
    await signInAsRole('teacher');
    await renderApp();
    await waitFor(() => expect(tabButton('More')).toBeTruthy());

    await fireEvent.press(tabButton('More'));
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { success: true }));
    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => expect(screen.getByTestId('authSubmitButton')).toBeTruthy());
  });

  it('navigates Classroom -> Class List -> Class Home -> Attendance for a signed-in teacher (§12)', async () => {
    await signInAsRole('teacher');
    await renderApp();
    await waitFor(() => expect(tabButton('Classroom')).toBeTruthy());

    await fireEvent.press(tabButton('Classroom'));
    expect(screen.getByText('Grade 6 - Section A')).toBeTruthy();

    await fireEvent.press(screen.getByText('Grade 6 - Section A'));
    expect(screen.getByText("Mark Today's Attendance")).toBeTruthy();

    await fireEvent.press(screen.getByText("Mark Today's Attendance"));
    expect(screen.getByText('Mark + Monthly Summary — Phase 9.')).toBeTruthy();
  });
});
