import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../types';
import { ClassListScreen } from '../../screens/classroom/ClassListScreen';
import { ClassHomeScreen } from '../../screens/classroom/ClassHomeScreen';
import { PlaceholderScreen } from '../../screens/PlaceholderScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<ClassroomStackParamList>();

// Class List -> Class Home -> {Students, Attendance, Fees, Reports}, each a
// stack screen pushed from Class Home, not sibling tabs (§12).
export function ClassroomStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ClassList" component={ClassListScreen} options={{ title: 'Classroom' }} />
      <Stack.Screen
        name="ClassHome"
        component={ClassHomeScreen}
        options={({ route }) => ({ title: route.params.className })}
      />
      <Stack.Screen name="Students" options={({ route }) => ({ title: `${route.params.className} — Students` })}>
        {() => <PlaceholderScreen title="Students" description="List + add/edit sheet — Phase 8." />}
      </Stack.Screen>
      <Stack.Screen name="Attendance" options={({ route }) => ({ title: `${route.params.className} — Attendance` })}>
        {() => <PlaceholderScreen title="Attendance" description="Mark + Monthly Summary — Phase 9." />}
      </Stack.Screen>
      <Stack.Screen name="Fees" options={({ route }) => ({ title: `${route.params.className} — Fees` })}>
        {() => <PlaceholderScreen title="Fees" description="Fee status board — Phase 10." />}
      </Stack.Screen>
      <Stack.Screen name="Reports" options={({ route }) => ({ title: `${route.params.className} — Reports` })}>
        {() => <PlaceholderScreen title="Reports" description="Cross-class analytics — Phase 11." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
