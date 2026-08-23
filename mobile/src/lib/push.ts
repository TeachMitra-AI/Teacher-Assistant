// OS-level push registration (Phase 7b, docs/mobile-app-plan.md §15, §26) —
// has no web analogue (the PWA client has no push-token concept), so this is
// pure new code rather than a port. Pure expo-notifications wrapper, no
// React state — same "lib/* is a plain function the provider calls" shape as
// lib/socket.ts: NotificationContext.tsx's existing per-signed-in-session
// effect is what calls registerForPushAsync() below, right alongside where
// it already opens the realtime socket.
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Foreground presentation: a push that arrives while the app is open and
// foregrounded is deliberately silent (no banner/sound) — the existing
// Socket.IO 'notification:new' handler (NotificationContext.tsx) already
// updates the unread badge/list live for that exact case, so an OS banner on
// top of it would just be a redundant, noisier duplicate of the same event.
// Push exists for the backgrounded/killed case that Socket.IO cannot reach
// (§15) — it isn't meant to compete with the realtime path while foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

let cachedToken: string | null = null;

/** The last Expo push token this device successfully registered, if any — read by AuthContext.logout() to unregister it server-side. */
export function getCachedPushToken(): string | null {
  return cachedToken;
}

/**
 * Requests notification permission, sets up the Android notification
 * channel (required on Android 8+, and must be created before the token
 * request on Android 13+), and returns this device's Expo push token.
 *
 * Returns null — never throws — for every case that isn't "the user has a
 * usable push token": permission denied, not a physical device, no EAS
 * projectId configured, or push simply unsupported in this runtime (Expo Go
 * on Android does not support push from SDK 53 onward — a development build
 * is required, see mobile/DEVICE_TESTING.md). None of these should ever be
 * able to break the sign-in flow that calls this.
 */
export async function registerForPushAsync(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return null;

    // EAS builds inline this into app config at build time; the local `eas`
    // CLI also writes it to app.json's extra.eas.projectId on `eas init`.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedToken = data;
    return data;
  } catch {
    return null;
  }
}
