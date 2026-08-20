import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { MainTabs } from './MainTabs';
import { useTheme } from '../theme/ThemeContext';

// No auth-gated pre-auth stack yet — that's Phase 3 (§10: "Login/Register/
// Forgot-Password/Reset-Password ... entirely separate root navigator,
// mirrors App.tsx:48-56's signed-out route tree"). Phase 2 wires the
// authenticated-app tree only.
export function RootNavigator() {
  const { mode, colors } = useTheme();

  const navTheme: Theme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.orange,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <MainTabs />
    </NavigationContainer>
  );
}
