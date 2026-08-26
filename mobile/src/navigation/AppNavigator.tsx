import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppStackParamList } from './types';
import { MainTabs } from './MainTabs';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { AdminAnalyticsScreen } from '../screens/admin/AdminAnalyticsScreen';
import { useStackScreenOptions } from './useStackScreenOptions';

const Stack = createNativeStackNavigator<AppStackParamList>();

// Root stack over the tab bar (web-UI-parity pass): Notifications/Settings/
// Sessions/Admin/HelpSupport are reached from Header's bell/avatar controls
// (navigationRef, from any tab) as pushed screens with a native back button,
// mirroring the web's header-bell dropdown and profile-dropdown placement
// instead of a dedicated "More" tab. See MainTabs.tsx and Header.tsx.
export function AppNavigator() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="Sessions" options={{ title: 'Signed-in devices' }}>
        {() => (
          <PlaceholderScreen
            title="Signed-in devices"
            description="GET/DELETE /auth/sessions — ready-made from the backend, needs a screen."
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Admin" component={AdminAnalyticsScreen} options={{ title: 'Admin' }} />
      <Stack.Screen name="HelpSupport" options={{ title: 'Need Help?' }}>
        {() => <PlaceholderScreen title="Need Help?" description="Later phase." />}
      </Stack.Screen>
      <Stack.Screen name="GettingStarted" options={{ title: 'Getting started' }}>
        {() => <PlaceholderScreen title="Getting started" description="Later phase." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
