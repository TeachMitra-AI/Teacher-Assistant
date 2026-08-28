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

// socket.io-client backs NotificationContext's realtime connection (Phase 7,
// mobile/src/lib/socket.ts) — a real `io()` call would attempt an actual
// network connection under the Jest test renderer (open handles, flaky
// tests). This default no-op socket (never emits 'connect' or
// 'notification:new') is enough for every test that merely renders the
// authenticated tree without exercising realtime behavior itself;
// NotificationContext.test.tsx overrides this with a more specific local
// mock to actually drive those events.
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

// expo-notifications/expo-constants back OS-level push (Phase 7b,
// mobile/src/lib/push.ts, mobile/src/notifications/usePushNotificationRouting.ts)
// — both reach for native modules that don't exist under the Jest test
// renderer. Default: permission NOT granted and no EAS projectId configured,
// so registerForPushAsync() resolves to null and every test that merely
// renders the authenticated tree never attempts a "real" registration —
// same "safe inert default" shape as the Google Sign-In mocks above.
// push.test.ts and usePushNotificationRouting.test.tsx override specific
// methods locally to exercise the granted/token/tap-response paths.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, status: 'denied' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[mock]', type: 'expo' }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
jest.mock('expo-constants', () => ({ expoConfig: {}, easConfig: undefined }));

// @react-native-async-storage/async-storage backs the offline attendance
// queue (Phase 12, mobile/src/lib/offlineQueue.ts) — the real native module
// doesn't exist under the Jest test renderer. A simple in-memory fake is
// enough for every test: offlineQueue.test.ts exercises real read/write
// round-trips against it, and every other test that merely renders a screen
// touching the queue needs it to behave, not to be spied on. Cleared between
// tests the same way jest's own module registry is (per-test isolation
// relies on each test file calling AsyncStorage.clear() itself, mirroring
// how other tests reset their own local state).
jest.mock('@react-native-async-storage/async-storage', () => {
  const memory = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(memory.has(key) ? memory.get(key)! : null)),
    setItem: jest.fn((key: string, value: string) => {
      memory.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      memory.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      memory.clear();
      return Promise.resolve();
    }),
  };
});

// @react-native-community/netinfo backs the offline queue's reconnect
// trigger (Phase 12, offlineQueue.ts's startAutoSync()) — same reasoning as
// AsyncStorage above. Default: registers the listener but never fires it;
// tests that need to simulate a reconnect invoke the captured listener
// directly via `(NetInfo.addEventListener as jest.Mock).mock.calls`.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));

// react-native's own AppState already has a working jest mock built into
// @react-native/jest-preset (jest/mocks/AppState.js, wired up in that
// preset's own setup.js) — no override needed here. Tests drive it via
// `(AppState.addEventListener as jest.Mock).mock.calls`.
