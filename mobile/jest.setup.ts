// react-native-safe-area-context needs a native layout event to populate
// insets/frame, which never fires under the test renderer — without this,
// SafeAreaProvider renders its subtree as empty until that event arrives, so
// every component test would find nothing. This is the library's own
// documented test mock (react-native-safe-area-context/jest/mock).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// expo-auth-session/expo-web-browser back the native Google Sign-In flow
// (mobile/src/auth/useGoogleIdToken.ts, docs/mobile-app-plan.md §16) — they
// reach for native modules (Linking, a browser bridge) that don't exist
// under the Jest test renderer. Every AuthScreen test runs with no Google
// client ID env vars set, so GOOGLE_SIGN_IN_AVAILABLE is already false and
// the real hook would never fire — this mock exists only so importing the
// module doesn't throw a missing-native-module error during render.
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [null, null, jest.fn()],
}));
