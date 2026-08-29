import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ManageUsersScreen } from '../ManageUsersScreen';
import type { Role } from '../../../../types';

jest.mock('../../../../api/admin', () => ({
  listAdminUsers: jest.fn(),
  changeUserRole: jest.fn(),
}));
const { listAdminUsers, changeUserRole } = jest.requireMock('../../../../api/admin') as {
  listAdminUsers: jest.Mock; changeUserRole: jest.Mock;
};

let mockUser: { role: Role } | null = null;
jest.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ManageUsersScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const USER_ROW = {
  id: 'u1', name: 'Jane Doe', email: 'jane@x.com', role: 'teacher' as Role, status: 'active' as const,
  school: 'Rampur High', schoolCode: 'RAMPUR03', lastLogin: '2026-08-20T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
};

describe('ManageUsersScreen', () => {
  beforeEach(() => {
    listAdminUsers.mockReset();
    changeUserRole.mockReset();
  });

  it('shows the role as plain text for a non-super_admin', async () => {
    mockUser = { role: 'school_admin' };
    listAdminUsers.mockResolvedValue({ items: [USER_ROW], total: 1, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());
    expect(screen.getByText('Teacher')).toBeTruthy();
    expect(screen.queryByLabelText('Role for Jane Doe')).toBeNull();
  });

  it('confirms and applies a role change for a super_admin', async () => {
    mockUser = { role: 'super_admin' };
    listAdminUsers.mockResolvedValue({ items: [USER_ROW], total: 1, page: 1, limit: 25 });
    changeUserRole.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.text !== 'Cancel')?.onPress?.();
    });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Role for Jane Doe'));
    await fireEvent.press(screen.getByText('School Admin'));

    await waitFor(() => expect(changeUserRole).toHaveBeenCalledWith('u1', 'school_admin'));
    await waitFor(() => expect(listAdminUsers).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mockUser = { role: 'super_admin' };
    listAdminUsers.mockResolvedValue({ items: [USER_ROW], total: 1, page: 1, limit: 25 });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Role for Jane Doe'));
    await fireEvent.press(screen.getByText('School Admin'));

    expect(changeUserRole).not.toHaveBeenCalled();
  });
});
