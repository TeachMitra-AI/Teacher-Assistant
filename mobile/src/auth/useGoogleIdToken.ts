// Native Google Sign-In (docs/mobile-app-plan.md §16). The web app's
// @react-oauth/google has no React Native binding, so this uses
// expo-auth-session's Google provider instead — it opens the system browser
// (not an embedded WebView Google would reject) and hands back an ID token,
// which is POSTed to the exact same POST /api/auth/google endpoint the web
// client already uses (server/src/lib/googleAuth.js verifies it identically
// regardless of which client SDK produced it — no backend change needed).
//
// UNVERIFIED ON-DEVICE (§26 Phase 3 risk note): this requires real
// Android/iOS/Web OAuth client IDs from Google Cloud Console, none of which
// are configured in this environment, and a custom-dev-client build (Expo Go
// cannot open a custom `teacherassistant://` redirect — see app.json's new
// "scheme"). The button below only renders when at least one client ID env
// var is set, mirroring the web app's own `{GOOGLE_CLIENT_ID && <GoogleLogin
// />}` guard (client/src/pages/LoginPage.tsx:459) — so an unconfigured build
// simply omits Google sign-in rather than showing a broken button.
import { useEffect } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const GOOGLE_SIGN_IN_AVAILABLE = Boolean(ANDROID_CLIENT_ID || IOS_CLIENT_ID || WEB_CLIENT_ID);

export function useGoogleIdToken(onToken: (idToken: string) => void, onError: (message: string) => void) {
  // useIdTokenAuthRequest's per-platform client ID (androidClientId on
  // Android, iosClientId on iOS) must not be `undefined` — it throws
  // synchronously on every render otherwise (confirmed on a physical device:
  // "Client Id property `androidClientId` must be defined..."), even though
  // the button that would call promptAsync() is already hidden behind
  // GOOGLE_SIGN_IN_AVAILABLE. An empty string satisfies that check without
  // ever producing a usable request — the hook's own `request` stays safe to
  // pass to a disabled/hidden button either way.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: ANDROID_CLIENT_ID || '',
    iosClientId: IOS_CLIENT_ID || '',
    webClientId: WEB_CLIENT_ID || '',
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token;
      if (idToken) onToken(idToken);
      else onError('Google did not return a sign-in token. Please try again.');
    } else if (response.type === 'error') {
      onError('Google sign-in was cancelled or failed. Please try again.');
    }
    // 'dismiss'/'cancel' response types need no message — the teacher just
    // closed the browser sheet, which isn't a failure worth surfacing.
  }, [response, onToken, onError]);

  return { request, promptAsync };
}
