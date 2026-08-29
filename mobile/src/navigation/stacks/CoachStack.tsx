import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CoachStackParamList } from '../types';
import { CoachScreen } from '../../screens/coach/CoachScreen';
import { Header } from '../../components/Header';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<CoachStackParamList>();

// Coach is the default/first tab (§10), matching '/' being the default web
// route. Chat UI (Phase 4) lives in screens/coach/CoachScreen.tsx. The root
// screen uses the shared web-parity Header (variant="coach": bell + inert
// context-filter icon, no avatar — matches the web header on Coach exactly).
// The `header` option set here is only the pre-mount fallback (no
// onMenuPress yet, so the sidebar toggle is briefly inert) — CoachScreen
// immediately overrides it via navigation.setOptions once it mounts, with
// the real handler that opens HistorySidebar.tsx.
export function CoachStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Chat"
        component={CoachScreen}
        options={{ header: () => <Header variant="coach" /> }}
      />
    </Stack.Navigator>
  );
}
