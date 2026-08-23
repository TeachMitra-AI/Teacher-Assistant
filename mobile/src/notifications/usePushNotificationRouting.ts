// Notification-TAP handling (Phase 7b, docs/mobile-app-plan.md §26 Phase
// 7b's own acceptance criteria: "tapping it deep-links correctly"). Covers
// all three states a tap can arrive from:
//   - foregrounded/backgrounded, app already running: addNotificationResponseReceivedListener fires live.
//   - killed, tap is what launches the app: by the time this hook's effect
//     runs, the tap already happened — getLastNotificationResponseAsync()
//     is Expo's own answer for "was this app cold-launched from a
//     notification", read once on mount.
// Mounted once from RootNavigator (see that file) — NOT scoped to the
// signed-in branch like NotificationProvider, because a cold-start tap must
// be handled the moment the NavigationContainer is ready, before
// AuthContext's own session-restore has necessarily resolved.
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { MOBILE_PUSH_ENABLED } from '../config';
import { navigateToNotificationLink } from './pushLinking';

function linkFromResponse(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { link?: string | null } | null;
  return data?.link ?? null;
}

export function usePushNotificationRouting(): void {
  useEffect(() => {
    if (!MOBILE_PUSH_ENABLED) return undefined;

    // Not a setState call: navigateToNotificationLink() is an imperative
    // navigationRef call, not React state, so no react-hooks/set-state-in-effect
    // suppression is needed here (unlike AuthContext.tsx/NotificationContext.tsx's
    // own fetch-on-mount effects, which do call setState).
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      navigateToNotificationLink(linkFromResponse(response));
      // Consumed — without this, the SAME cold-start response would be
      // re-read (and re-navigated to) on every future call to
      // getLastNotificationResponseAsync() for the rest of the app's
      // process lifetime, e.g. if this hook ever remounts.
      Notifications.clearLastNotificationResponseAsync();
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateToNotificationLink(linkFromResponse(response));
    });

    return () => subscription.remove();
  }, []);
}
