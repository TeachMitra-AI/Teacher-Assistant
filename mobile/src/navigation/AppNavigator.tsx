import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppStackParamList } from './types';
import { MainTabs } from './MainTabs';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { AdminScreen } from '../screens/admin/AdminScreen';
import { AdminSupportTicketScreen } from '../screens/admin/support/AdminSupportTicketScreen';
import { HelpSupportScreen } from '../screens/HelpSupportScreen';
import { GettingStartedScreen } from '../screens/GettingStartedScreen';
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
      <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Admin' }} />
      <Stack.Screen
        name="AdminSupportTicket"
        component={AdminSupportTicketScreen}
        options={({ route }) => ({ title: `Ticket #${route.params.id.slice(-8)}` })}
      />
      {/* title here is only the pre-mount fallback — HelpSupportScreen.tsx
          overrides it via navigation.setOptions once mounted, per its
          current internal view (menu/bug/feedback/contact/success). */}
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: 'Need Help?' }} />
      <Stack.Screen name="GettingStarted" component={GettingStartedScreen} options={{ title: 'Getting started' }} />
    </Stack.Navigator>
  );
}
