import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { MainTabs } from './MainTabs';
import { AuthNavigator } from './AuthNavigator';
import { AuthLoadingScreen } from '../screens/auth/AuthScreen';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { NotificationProvider } from '../notifications/NotificationContext';

// §10/§26 Phase 3: an entirely separate root navigator for signed-out vs
// signed-in, mirroring App.tsx's own signed-out route tree on web. Switching
// `user` from null to a User (or back) swaps the whole tree — React
// Navigation unmounts the old one, so there is no stale authenticated screen
// left reachable after logout/session expiry.
//
// §26 Phase 7: NotificationProvider (the realtime bell/badge state) wraps
// MainTabs right here, inside the authenticated branch, rather than
// mounting globally the way the web's App.tsx does. This repo's mobile root
// already structurally separates signed-in/signed-out subtrees (the comment
// above), so scoping the provider to the branch that actually needs it gets
// the same "no stale socket reachable after logout" guarantee for free (the
// whole subtree — and its socket — unmounts on sign-out) without needing an
// internal `if (!user)` early-return AND an outer always-mounted provider
// the way the web version needs.
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
      {loading ? (
        <AuthLoadingScreen />
      ) : user ? (
        <NotificationProvider>
          <MainTabs />
        </NotificationProvider>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
