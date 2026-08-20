import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { MainTabs } from './MainTabs';
import { AuthNavigator } from './AuthNavigator';
import { AuthLoadingScreen } from '../screens/auth/AuthScreen';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

// §10/§26 Phase 3: an entirely separate root navigator for signed-out vs
// signed-in, mirroring App.tsx's own signed-out route tree on web. Switching
// `user` from null to a User (or back) swaps the whole tree — React
// Navigation unmounts the old one, so there is no stale authenticated screen
// left reachable after logout/session expiry.
export function RootNavigator() {
  const { mode, colors } = useTheme();
  const { user, loading } = useAuth();

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
      {loading ? <AuthLoadingScreen /> : user ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
