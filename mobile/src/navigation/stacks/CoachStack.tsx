import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CoachStackParamList } from '../types';
import { CoachScreen } from '../../screens/coach/CoachScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<CoachStackParamList>();

// Coach is the default/first tab (§10), matching '/' being the default web
// route. Chat UI (Phase 4) lives in screens/coach/CoachScreen.tsx.
export function CoachStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Chat" component={CoachScreen} options={{ title: 'Coach' }} />
    </Stack.Navigator>
  );
}
