// Covers AdminManageScreen.tsx's sub-tab gating: Schools is super_admin
// only, matching ManagePage.tsx's `isSuperAdmin` section gate on web.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { AdminManageScreen } from '../AdminManageScreen';
import type { Role } from '../../../../types';

// require() inside each factory (not a top-level import) is required here —
// babel-plugin-jest-hoist forbids a jest.mock() factory from closing over
// any out-of-scope identifier, imports included, unless it's lazily required.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../ManageSchoolsScreen', () => ({ ManageSchoolsScreen: () => { const { Text } = require('react-native'); return <Text>schools-content</Text>; } }));
jest.mock('../ManagePendingScreen', () => ({ ManagePendingScreen: () => { const { Text } = require('react-native'); return <Text>pending-content</Text>; } }));
jest.mock('../ManageUsersScreen', () => ({ ManageUsersScreen: () => { const { Text } = require('react-native'); return <Text>users-content</Text>; } }));
/* eslint-enable @typescript-eslint/no-require-imports */

let mockUser: { role: Role } | null = null;
jest.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

async function renderScreen() {
  await render(
    <ThemeProvider>
      <AdminManageScreen />
    </ThemeProvider>
  );
}

describe('AdminManageScreen', () => {
  it('shows Schools/Pending/Users and defaults to Schools for a super_admin', async () => {
    mockUser = { role: 'super_admin' };
    await renderScreen();

    expect(screen.getByTestId('manage-tab-schools')).toBeTruthy();
    expect(screen.getByTestId('manage-tab-pending')).toBeTruthy();
    expect(screen.getByTestId('manage-tab-users')).toBeTruthy();
    expect(screen.getByText('schools-content')).toBeTruthy();
  });

  it('hides Schools and defaults to Pending for a school_admin', async () => {
    mockUser = { role: 'school_admin' };
    await renderScreen();

    expect(screen.queryByTestId('manage-tab-schools')).toBeNull();
    expect(screen.getByText('pending-content')).toBeTruthy();
  });

  it('switches to Users when pressed', async () => {
    mockUser = { role: 'super_admin' };
    await renderScreen();

    await fireEvent.press(screen.getByTestId('manage-tab-users'));
    expect(screen.getByText('users-content')).toBeTruthy();
  });
});
