import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { GeneratorStackParamList } from '../types';
import { PlaceholderScreen } from '../../screens/PlaceholderScreen';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<GeneratorStackParamList>();

// Form -> Result/Preview (§10, §11). Phase 6 builds these.
export function GeneratorStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="GeneratorForm" options={{ title: 'Generator' }}>
        {() => <PlaceholderScreen title="Generator" description="Quiz/worksheet generation form — Phase 6." />}
      </Stack.Screen>
      <Stack.Screen name="GeneratorResult" options={{ title: 'Result' }}>
        {() => <PlaceholderScreen title="Result" description="Phase 6." />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
