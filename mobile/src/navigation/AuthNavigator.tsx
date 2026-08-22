import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from './types';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { useStackScreenOptions } from './useStackScreenOptions';

const Stack = createNativeStackNavigator<AuthStackParamList>();

// Signed-out route tree (§26 Phase 3), rendered by RootNavigator in place of
// MainTabs whenever there is no authenticated user.
export function AuthNavigator() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, headerShown: false }}>
      <Stack.Screen name="Login" component={AuthScreen} />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ headerShown: true, title: 'Forgot password' }}
      />
    </Stack.Navigator>
  );
}
