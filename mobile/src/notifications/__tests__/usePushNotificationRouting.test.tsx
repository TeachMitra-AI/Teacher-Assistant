// usePushNotificationRouting (Phase 7b) — the killed-app cold-start tap
// (getLastNotificationResponseAsync) and the live-tap listener
// (addNotificationResponseReceivedListener), both routed through
// navigateToNotificationLink(). A tiny host component mounts the hook, same
// "context/hook has nothing to render-assert on its own" approach
// NotificationContext.test.tsx already uses.
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { usePushNotificationRouting } from '../usePushNotificationRouting';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  MOBILE_PUSH_ENABLED: true,
}));

jest.mock('../pushLinking', () => ({ navigateToNotificationLink: jest.fn() }));
const { navigateToNotificationLink } = jest.requireMock('../pushLinking') as { navigateToNotificationLink: jest.Mock };

function Host() {
  usePushNotificationRouting();
  return <Text>host</Text>;
}

function notificationResponse(link: string | null) {
  return {
    notification: { request: { content: { data: { link } } } },
  } as unknown as Notifications.NotificationResponse;
}

describe('usePushNotificationRouting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
  });

  it('navigates to the link from a cold-start response, then clears it', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(notificationResponse('/library/abc'));

    render(<Host />);

    await waitFor(() => expect(navigateToNotificationLink).toHaveBeenCalledWith('/library/abc'));
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('does nothing on mount when there is no cold-start response', async () => {
    render(<Host />);

    await waitFor(() => expect(Notifications.getLastNotificationResponseAsync).toHaveBeenCalled());
    expect(navigateToNotificationLink).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  });

  it('navigates on a live tap response while mounted', async () => {
    render(<Host />);
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    const liveHandler = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];
    liveHandler(notificationResponse('/generator'));

    expect(navigateToNotificationLink).toHaveBeenCalledWith('/generator');
  });

  it('removes the live-tap subscription on unmount', async () => {
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({ remove });

    const { unmount } = await render(<Host />);
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      unmount();
    });
    expect(remove).toHaveBeenCalled();
  });
});
