// Separate file (not a case inside NotificationContext.test.tsx) purely so
// NOTIFICATIONS_ENABLED can be mocked false at module scope without the
// jest.resetModules()/jest.doMock() gymnastics that would take to flip it
// mid-file — matching this repo's established one-config-value-per-file
// convention (GeneratorResultScreen.test.tsx's own comment on why it mocks
// ../../config directly).
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { NotificationProvider } from '../NotificationContext';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  NOTIFICATIONS_ENABLED: false,
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Demo Teacher' } }),
}));

jest.mock('../../api/notifications', () => ({
  ...jest.requireActual('../../api/notifications'),
  getUnreadCount: jest.fn(),
}));

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

const { getUnreadCount } = jest.requireMock('../../api/notifications') as { getUnreadCount: jest.Mock };

describe('NotificationProvider with NOTIFICATIONS_ENABLED off', () => {
  it('never opens a socket or fetches the unread count', async () => {
    await render(
      <NotificationProvider>
        <></>
      </NotificationProvider>
    );

    // Let any pending mount-effect microtasks flush before asserting nothing
    // fired — there is nothing to "wait for" becoming true here (the
    // expectation is that these calls never happen), so a real waitFor()
    // retry loop would just pass instantly rather than genuinely waiting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(io).not.toHaveBeenCalled();
    expect(getUnreadCount).not.toHaveBeenCalled();
  });
});
