import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ManagePendingScreen } from '../ManagePendingScreen';
import type { Role } from '../../../../types';

jest.mock('../../../../api/admin', () => ({
  listPendingUsers: jest.fn(),
  decidePendingUser: jest.fn(),
}));
const { listPendingUsers, decidePendingUser } = jest.requireMock('../../../../api/admin') as {
  listPendingUsers: jest.Mock; decidePendingUser: jest.Mock;
};

let mockUser: { role: Role } | null = null;
jest.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ManagePendingScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const PENDING_ROW = { id: 'u1', name: 'Jane Doe', email: 'jane@x.com', role: 'teacher', status: 'pending', school: 'Rampur High', schoolCode: 'RAMPUR03', createdAt: '2026-08-01T00:00:00Z' };

describe('ManagePendingScreen', () => {
  beforeEach(() => {
    listPendingUsers.mockReset();
    decidePendingUser.mockReset();
  });

  it('shows Approve/Reject for a school_admin', async () => {
    mockUser = { role: 'school_admin' };
    listPendingUsers.mockResolvedValue({ items: [PENDING_ROW], total: 1, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());
    expect(screen.getByTestId('pending-approve-u1')).toBeTruthy();
    expect(screen.getByTestId('pending-reject-u1')).toBeTruthy();
  });

  it('hides Approve/Reject for a resource_person (read-only)', async () => {
    mockUser = { role: 'resource_person' };
    listPendingUsers.mockResolvedValue({ items: [PENDING_ROW], total: 1, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());
    expect(screen.queryByTestId('pending-approve-u1')).toBeNull();
  });

  it('approves a teacher and refetches the queue', async () => {
    mockUser = { role: 'super_admin' };
    listPendingUsers.mockResolvedValue({ items: [PENDING_ROW], total: 1, page: 1, limit: 25 });
    decidePendingUser.mockResolvedValue(undefined);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('pending-approve-u1'));

    await waitFor(() => expect(decidePendingUser).toHaveBeenCalledWith('u1', 'approve'));
    await waitFor(() => expect(listPendingUsers).toHaveBeenCalledTimes(2));
  });

  it('shows an error and still refetches on a failed decision', async () => {
    mockUser = { role: 'super_admin' };
    listPendingUsers.mockResolvedValue({ items: [PENDING_ROW], total: 1, page: 1, limit: 25 });
    decidePendingUser.mockRejectedValue(new Error('network down'));
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('pending-reject-u1'));

    expect(await screen.findByText('Could not reject this teacher')).toBeTruthy();
  });
});
