import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { LibraryStackParamList } from '../types';
import { PlaceholderScreen } from '../../screens/PlaceholderScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<LibraryStackParamList>();

// List -> Resource View -> Resource Edit (§10, §11). Phase 5 builds these.
export function LibraryStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ResourceList" options={{ title: 'Library' }}>
        {() => <PlaceholderScreen title="Library" description="List/view/edit saved resources — Phase 5." />}
      </Stack.Screen>
      <Stack.Screen name="ResourceView" options={{ title: 'Resource' }}>
        {() => <PlaceholderScreen title="Resource" description="Phase 5." />}
      </Stack.Screen>
      <Stack.Screen name="ResourceEdit" options={{ title: 'Edit Resource' }}>
        {() => <PlaceholderScreen title="Edit Resource" description="Phase 5." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
