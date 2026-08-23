// Own file specifically so MOBILE_PUSH_ENABLED: false can be module-mocked
// without jest.resetModules() gymnastics mid-file — same reasoning
// NotificationContext.disabled.test.tsx already documents for
// NOTIFICATIONS_ENABLED.
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { usePushNotificationRouting } from '../usePushNotificationRouting';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  MOBILE_PUSH_ENABLED: false,
}));

function Host() {
  usePushNotificationRouting();
  return <Text>host</Text>;
}

test('makes no Expo Notifications call at all when MOBILE_PUSH_ENABLED is off', () => {
  render(<Host />);
  expect(Notifications.getLastNotificationResponseAsync).not.toHaveBeenCalled();
  expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
});
