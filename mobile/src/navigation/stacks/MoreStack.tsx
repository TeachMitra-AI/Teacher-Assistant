import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../types';
import { MoreMenuScreen } from '../../screens/MoreMenuScreen';
import { PlaceholderScreen } from '../../screens/PlaceholderScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<MoreStackParamList>();

// Menu -> {Notifications, Settings, Sessions, Admin*, Help & Support} (§10).
// Admin is role-gated in MoreMenuScreen itself, not by hiding the route here
// — matching how App.tsx gates the /admin route on web (the route exists;
// reaching it without the role is what's prevented).
export function MoreStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'More' }} />
      <Stack.Screen name="Notifications" options={{ title: 'Notifications' }}>
        {() => <PlaceholderScreen title="Notifications" description="List + realtime — Phase 7." />}
      </Stack.Screen>
      <Stack.Screen name="Settings" options={{ title: 'Settings' }}>
        {() => <PlaceholderScreen title="Settings" description="Profile + preferences — later phase." />}
      </Stack.Screen>
      <Stack.Screen name="Sessions" options={{ title: 'Signed-in devices' }}>
        {() => (
          <PlaceholderScreen
            title="Signed-in devices"
            description="GET/DELETE /auth/sessions — ready-made from the backend (§4.1), needs a screen."
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Admin" options={{ title: 'Admin' }}>
        {() => <PlaceholderScreen title="Admin" description="Deferred — §26 note on Phase 11." />}
      </Stack.Screen>
      <Stack.Screen name="HelpSupport" options={{ title: 'Help & Support' }}>
        {() => <PlaceholderScreen title="Help & Support" description="Later phase." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
