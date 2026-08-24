// A module-level ref to the app's single NavigationContainer (attached in
// RootNavigator.tsx), so a push-notification tap can navigate imperatively
// from OUTSIDE the component tree that received the tap event — the
// standard React Navigation pattern for exactly this case (see
// notifications/pushLinking.ts, the only current caller).
import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';

// Untyped against a specific param list ON PURPOSE: NavigationContainer's
// mounted tree switches between AuthStackParamList and MainTabParamList
// depending on sign-in state (RootNavigator.tsx), and this ref is read from
// OUTSIDE either of those subtrees (a push tap can arrive before/after
// either is mounted) — there is no single root param list that could type
// this precisely. pushLinking.ts's own resolveNotificationLink() is what
// keeps the actual route names honest against navigation/types.ts.
export const navigationRef = createNavigationContainerRef<ParamListBase>();
