// Covers AdminScreen.tsx's tab-visibility gating — the actual security
// boundary is server-side (requireRole on every endpoint), but this proves
// the UI matches AdminTabs.tsx on web: Support/Settings are super_admin
// only, Notifications is gated by NOTIFICATIONS_ENABLED, Overview/Manage
// are visible to every admin role. Every child tab screen is mocked to a
// stub — each has its own test file covering its real behavior.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { AdminScreen } from '../AdminScreen';
import type { Role } from '../../../types';

// require() inside each factory (not a top-level import) is required here —
// babel-plugin-jest-hoist forbids a jest.mock() factory from closing over
// any out-of-scope identifier, imports included, unless it's lazily required.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../AdminAnalyticsScreen', () => ({ AdminAnalyticsScreen: () => { const { Text } = require('react-native'); return <Text>overview-content</Text>; } }));
jest.mock('../manage/AdminManageScreen', () => ({ AdminManageScreen: () => { const { Text } = require('react-native'); return <Text>manage-content</Text>; } }));
jest.mock('../support/AdminSupportScreen', () => ({ AdminSupportScreen: () => { const { Text } = require('react-native'); return <Text>support-content</Text>; } }));
jest.mock('../notifications/AdminNotificationsScreen', () => ({ AdminNotificationsScreen: () => { const { Text } = require('react-native'); return <Text>notifications-content</Text>; } }));
jest.mock('../settings/AdminSettingsScreen', () => ({ AdminSettingsScreen: () => { const { Text } = require('react-native'); return <Text>settings-content</Text>; } }));
/* eslint-enable @typescript-eslint/no-require-imports */

let mockUser: { role: Role } | null = null;
jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../../../config', () => ({
  ...jest.requireActual('../../../config'),
  NOTIFICATIONS_ENABLED: true,
}));

async function renderScreen() {
  const navigation = { navigate: jest.fn() };
  await render(
    <ThemeProvider>
      <AdminScreen navigation={navigation as never} route={{ key: 'a', name: 'Admin', params: undefined } as never} />
    </ThemeProvider>
  );
}

describe('AdminScreen', () => {
  it('shows all five tabs for a super_admin, defaulting to Overview', async () => {
    mockUser = { role: 'super_admin' };
    await renderScreen();

    expect(screen.getByTestId('admin-tab-overview')).toBeTruthy();
    expect(screen.getByTestId('admin-tab-manage')).toBeTruthy();
    expect(screen.getByTestId('admin-tab-support')).toBeTruthy();
    expect(screen.getByTestId('admin-tab-notifications')).toBeTruthy();
    expect(screen.getByTestId('admin-tab-settings')).toBeTruthy();
    expect(screen.getByText('overview-content')).toBeTruthy();
  });

  it('hides Support and Settings for a school_admin', async () => {
    mockUser = { role: 'school_admin' };
    await renderScreen();

    expect(screen.getByTestId('admin-tab-overview')).toBeTruthy();
    expect(screen.getByTestId('admin-tab-manage')).toBeTruthy();
    expect(screen.queryByTestId('admin-tab-support')).toBeNull();
    expect(screen.queryByTestId('admin-tab-settings')).toBeNull();
  });

  it('switches the rendered content when a tab is pressed', async () => {
    mockUser = { role: 'super_admin' };
    await renderScreen();

    await fireEvent.press(screen.getByTestId('admin-tab-manage'));
    expect(screen.getByText('manage-content')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('admin-tab-support'));
    expect(screen.getByText('support-content')).toBeTruthy();
  });
});
