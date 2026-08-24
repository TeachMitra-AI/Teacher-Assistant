// Own file specifically so MOBILE_PUSH_ENABLED: true can be module-mocked
// without disturbing NotificationContext.test.tsx's own config mock — same
// "own file per flag value" reasoning NotificationContext.disabled.test.tsx
// already documents. Covers Phase 7b's push-registration effect: register on
// sign-in, register the returned token with the backend, never register when
// there is no token, and re-register on a subsequent sign-in (new user id).
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { NotificationProvider } from '../NotificationContext';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  NOTIFICATIONS_ENABLED: false,
  MOBILE_PUSH_ENABLED: true,
}));

// jest.mock() factories are hoisted above ordinary variable declarations and
// may only reference names prefixed with "mock" (Jest's own escape hatch for
// exactly this case) — hence `mockCurrentUser`, not a plainly-named variable.
let mockCurrentUser: { id: string } | null = { id: 'u1' };
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));

jest.mock('../../api/session', () => ({ getToken: jest.fn().mockResolvedValue('tok') }));
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

jest.mock('../../lib/push', () => ({ registerForPushAsync: jest.fn() }));
jest.mock('../../api/notifications', () => {
  const actual = jest.requireActual('../../api/notifications');
  return { ...actual, getUnreadCount: jest.fn().mockResolvedValue(0), registerDeviceToken: jest.fn() };
});

const { registerForPushAsync } = jest.requireMock('../../lib/push') as { registerForPushAsync: jest.Mock };
const { registerDeviceToken } = jest.requireMock('../../api/notifications') as { registerDeviceToken: jest.Mock };

async function renderProvider() {
  return render(
    <NotificationProvider>
      <Text>host</Text>
    </NotificationProvider>
  );
}

describe('NotificationProvider — push registration (MOBILE_PUSH_ENABLED)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { id: 'u1' };
    (io as jest.Mock).mockReturnValue({ on: jest.fn(), off: jest.fn(), disconnect: jest.fn() });
    registerDeviceToken.mockResolvedValue(undefined);
  });

  it('registers for push and sends the token to the backend on sign-in', async () => {
    registerForPushAsync.mockResolvedValue('ExponentPushToken[abc]');
    await renderProvider();

    await waitFor(() => expect(registerForPushAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(registerDeviceToken).toHaveBeenCalledWith('ExponentPushToken[abc]', expect.any(String)));
  });

  it('never calls registerDeviceToken when registerForPushAsync resolves null (no permission/no token)', async () => {
    registerForPushAsync.mockResolvedValue(null);
    await renderProvider();

    await waitFor(() => expect(registerForPushAsync).toHaveBeenCalledTimes(1));
    expect(registerDeviceToken).not.toHaveBeenCalled();
  });

  it('a failed registerDeviceToken call is swallowed, not thrown', async () => {
    registerForPushAsync.mockResolvedValue('ExponentPushToken[abc]');
    registerDeviceToken.mockRejectedValue(new Error('offline'));

    await expect(renderProvider()).resolves.toBeTruthy();
    await waitFor(() => expect(registerDeviceToken).toHaveBeenCalled());
  });

  it('re-registers on a subsequent sign-in (user id change)', async () => {
    registerForPushAsync.mockResolvedValue('ExponentPushToken[first]');
    const view = await renderProvider();
    await waitFor(() => expect(registerForPushAsync).toHaveBeenCalledTimes(1));

    mockCurrentUser = { id: 'u2' };
    registerForPushAsync.mockResolvedValue('ExponentPushToken[second]');
    await act(async () => {
      view.rerender(
        <NotificationProvider>
          <Text>host</Text>
        </NotificationProvider>
      );
    });

    await waitFor(() => expect(registerForPushAsync).toHaveBeenCalledTimes(2));
    expect(registerDeviceToken).toHaveBeenLastCalledWith('ExponentPushToken[second]', expect.any(String));
  });
});
