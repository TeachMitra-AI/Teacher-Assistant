import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CoachStackParamList } from '../types';
import { PlaceholderScreen } from '../../screens/PlaceholderScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<CoachStackParamList>();

// Coach is the default/first tab (§10), matching '/' being the default web
// route. Chat itself is Phase 4 — this is the stub.
export function CoachStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Chat" options={{ title: 'Coach' }}>
        {() => <PlaceholderScreen title="Coach" description="Chat UI over POST /api/coach — Phase 4." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
