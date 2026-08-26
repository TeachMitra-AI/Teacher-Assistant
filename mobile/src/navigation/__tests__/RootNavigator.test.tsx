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

// NOTIFICATIONS_ENABLED is read once at module load from an env var
// (mobile/src/config.ts) — Jest doesn't run Metro's EXPO_PUBLIC_* inlining,
// so process.env alone leaves it false here. Mocking the config module
// directly is this repo's own established way around that (same reasoning
// GeneratorResultScreen.test.tsx documents for STRUCTURED_QUESTIONS_ENABLED).
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  NOTIFICATIONS_ENABLED: true,
}));

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

  it('restores an authenticated session on launch and shows the 4-tab bar', async () => {
    await signInAsRole('teacher');
    await renderApp();

    await waitFor(() => expect(tabButton('Coach')).toBeTruthy());
    expect(tabButton('Library')).toBeTruthy();
    expect(tabButton('Classroom')).toBeTruthy();
    expect(tabButton('Generator')).toBeTruthy();
    // No "More" tab (web-UI-parity pass) — Notifications/Settings/Sign out
    // are reached from the header instead (see tests below).
    expect(screen.queryByRole('button', { name: /^More, tab,/ })).toBeNull();
    // Coach is the default/first tab (§10) — its own chat screen (Phase 4)
    // renders immediately, not a placeholder, confirming the authenticated
    // session flows all the way through to the actual Coach UI rather than
    // just an empty tab bar.
    expect(screen.getByText('Hi Asha Verma 👋')).toBeTruthy();
    expect(screen.getByTestId('coach-composer-input')).toBeTruthy();
  });

  it('shows an unread-notifications badge on the header bell after sign-in (§26 Phase 7)', async () => {
    await setSession('valid-token', 'valid-refresh');
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse(200, { user: mockUser('teacher'), featureFlags: { learningRepresentationEnabled: false } })
      )
      // NotificationProvider's mount-time refreshUnreadCount() — the second
      // fetch call once a session is restored (§15's reconnect-then-refresh
      // backstop fires the same call, but only on a socket 'connect' event,
      // which the globally-mocked no-op socket in jest.setup.ts never emits).
      .mockResolvedValueOnce(jsonResponse(200, { count: 3 }));
    await renderApp();

    await waitFor(() => expect(screen.getByTestId('header-notif-badge')).toBeTruthy());
    expect(screen.getByTestId('header-notif-badge')).toHaveTextContent('3');
  });

  it('hides Admin from Settings for a teacher', async () => {
    await signInAsRole('teacher');
    await renderApp();
    await waitFor(() => expect(tabButton('Library')).toBeTruthy());
    // Library (not Coach) shows the profile avatar in its header — Coach
    // swaps it for the teaching-context filter icon (Header.tsx).
    await fireEvent.press(tabButton('Library'));

    await fireEvent.press(screen.getByTestId('header-avatar'));
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Signed-in devices')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows Admin in Settings for a school_admin', async () => {
    await signInAsRole('school_admin');
    await renderApp();
    await waitFor(() => expect(tabButton('Library')).toBeTruthy());
    await fireEvent.press(tabButton('Library'));

    await fireEvent.press(screen.getByTestId('header-avatar'));
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('signing out from the profile menu returns to the sign-in screen', async () => {
    await signInAsRole('teacher');
    await renderApp();
    await waitFor(() => expect(tabButton('Library')).toBeTruthy());
    await fireEvent.press(tabButton('Library'));

    await fireEvent.press(screen.getByTestId('header-avatar'));
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { success: true }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByTestId('authSubmitButton')).toBeTruthy());
  });

  it('navigates Classroom -> Class List -> Class Home -> Attendance for a signed-in teacher (§12)', async () => {
    await signInAsRole('teacher');
    // Beyond the queued /auth/me response above, this screen tree also fires
    // NotificationProvider's mount-time unread-count fetch (see the "shows an
    // unread-notifications badge" test above), ClassListScreen fetches
    // GET /classroom/classes both on mount and on the navigator 'focus' event
    // it fires when the tab first becomes active (same reload-on-focus
    // pattern as ResourceListScreen.tsx), and — once Attendance is reached —
    // GET .../attendance?date= (Class Home's own summary strip, then
    // MarkAttendanceScreen's roster load, §13). Rather than guess the exact
    // call count/order, respond by URL for every call after the queued
    // auth/me one.
    (globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/attendance?date=')) {
        return Promise.resolve(
          jsonResponse(200, { date: '2026-08-26', roster: [], summary: { present: 0, absent: 0, unmarked: 0, percentage: null } })
        );
      }
      if (url.includes('/classroom/classes')) {
        return Promise.resolve(
          jsonResponse(200, {
            classes: [
              { id: 'c1', name: 'Grade 6 - Section A', grade: 'Grade 6', section: 'A', archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            ],
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { count: 0 }));
    });
    await renderApp();
    await waitFor(() => expect(tabButton('Classroom')).toBeTruthy());

    await fireEvent.press(tabButton('Classroom'));
    await waitFor(() => expect(screen.getByText('Grade 6 - Section A')).toBeTruthy());

    await fireEvent.press(screen.getByText('Grade 6 - Section A'));
    expect(screen.getByText("Mark Today's Attendance")).toBeTruthy();

    await fireEvent.press(screen.getByText("Mark Today's Attendance"));
    // The real Phase 9 screen — Mark/Monthly segmented control, defaulting
    // to Mark Attendance, with the (empty, per the mocked roster) roster
    // loaded from the real endpoint rather than a placeholder.
    await waitFor(() => expect(screen.getByTestId('attendance-tab-mark')).toBeTruthy());
    expect(screen.getByText('No active students')).toBeTruthy();
  });
});
