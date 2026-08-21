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

// expo-print/expo-sharing back the Library export/share flow (Phase 5,
// §19 — the window.print() replacement) — both reach for native modules
// that don't exist under the Jest test renderer. Screen tests mock these
// per-test to assert the request shape; this default keeps any test that
// doesn't care about export from crashing on import.
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock.pdf', base64: 'bW9jay1wZGY=' }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

// expo-file-system/legacy backs lib/exportPdf.ts's write-base64-to-cache
// step (a real, on-device bug fix — see that file's own comment for why
// this writes fresh bytes rather than reading printToFileAsync's own file).
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///mock-cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
