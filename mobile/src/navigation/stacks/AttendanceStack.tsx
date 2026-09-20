import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AttendanceStackParamList } from '../types';
import { AttendanceHomeScreen } from '../../screens/attendance/AttendanceHomeScreen';
import { Header } from '../../components/Header';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<AttendanceStackParamList>();

// One root screen (its own internal segmented sub-tabs — see
// AttendanceHomeScreen.tsx) rather than five separate pushed screens. The
// root screen uses the shared web-parity Header (bell + profile avatar),
// same as every other tab's stack.
export function AttendanceStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="AttendanceHome"
        component={AttendanceHomeScreen}
        options={{ header: () => <Header /> }}
      />
    </Stack.Navigator>
  );
}
