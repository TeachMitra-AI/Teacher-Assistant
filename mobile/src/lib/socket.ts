// Ported from client/src/lib/socket.ts (docs/mobile-app-plan.md §9, §26 Phase
// 7) — same socket.io-client API, works unmodified under React Native/Expo
// (§4.4). Only real difference: `getToken` is async here (expo-secure-store,
// not localStorage — same deviation Phase 1's api/client.ts already made for
// the REST layer), so the `auth` callback awaits it instead of reading
// synchronously. socket.io-client's `auth` option accepts a function exactly
// for this shape: it's invoked fresh on every (re)connect attempt, so a
// socket that reconnects after the access token has rotated (app resumed
// from background hours later) presents whatever token is current then.
import { io, type Socket } from 'socket.io-client';
import { SOCKET_BASE } from '../config';

export function connectNotificationSocket(getToken: () => Promise<string | null>): Socket {
  return io(SOCKET_BASE, {
    path: '/socket.io',
    auth: (cb) => {
      getToken().then((token) => cb({ token }));
    },
    // WebSocket-only, unlike the web client (which allows both, long-polling
    // first). React Native's XMLHttpRequest polyfill doesn't fully implement
    // what engine.io-client's polling transport needs (verified on-device,
    // Phase 7 physical-device pass): the handshake XHR never completes and
    // never surfaces an error — it just never reaches the server, so no
    // 'connect_error' fires and nothing appears in server logs either.
    // Forcing 'websocket' skips that transport entirely.
    transports: ['websocket'],
    reconnection: true,
  });
}
