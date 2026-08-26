import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { GeneratorStackParamList } from '../types';
import { GeneratorFormScreen } from '../../screens/generator/GeneratorFormScreen';
import { GeneratorResultScreen } from '../../screens/generator/GeneratorResultScreen';
import { Header } from '../../components/Header';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<GeneratorStackParamList>();

// Form -> Result/Preview (§10, §11) — Generator v2 Stage 3
// (docs/generator-v2-plan.md, docs/mobile-app-plan.md Phase 6). The root
// screen uses the shared web-parity Header (bell + profile avatar).
export function GeneratorStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="GeneratorForm"
        component={GeneratorFormScreen}
        options={{ header: () => <Header /> }}
      />
      <Stack.Screen name="GeneratorResult" component={GeneratorResultScreen} options={{ title: 'Review & Save' }} />
    </Stack.Navigator>
  );
}
