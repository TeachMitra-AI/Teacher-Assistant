import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { LibraryStackParamList } from '../types';
import { useStackScreenOptions } from '../useStackScreenOptions';
import { ResourceListScreen } from '../../screens/library/ResourceListScreen';
import { ResourceViewScreen } from '../../screens/library/ResourceViewScreen';
import { ResourceEditScreen } from '../../screens/library/ResourceEditScreen';

const Stack = createNativeStackNavigator<LibraryStackParamList>();

// List -> Resource View -> Resource Edit (§10, §11, §26 Phase 5).
export function LibraryStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ResourceList" component={ResourceListScreen} options={{ title: 'Library' }} />
      <Stack.Screen name="ResourceView" component={ResourceViewScreen} options={{ title: 'Resource' }} />
      <Stack.Screen name="ResourceEdit" component={ResourceEditScreen} options={{ title: 'Edit Resource' }} />
    </Stack.Navigator>
  );
}
