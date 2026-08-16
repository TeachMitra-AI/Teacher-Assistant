// Thin wrapper over socket.io-client for realtime notification delivery.
// Used only by components/Notifications.tsx's provider — nothing else in
// the app needs a socket. See docs/notification-system-plan.md §5.
import { io, type Socket } from 'socket.io-client';
import { SOCKET_BASE } from '../config';

/**
 * Opens a connection authenticated via `auth.token` — never a cookie,
 * matching this app's Bearer-token-only auth model everywhere else (api.ts).
 *
 * `getToken` is called fresh on EVERY (re)connect attempt (socket.io-client
 * supports `auth` as a function for exactly this), not just once at open —
 * the access token is short-lived (15m default) and rotates via api.ts's
 * silent refresh, so a socket that reconnects hours later (laptop woke from
 * sleep, network blip) must present whatever token is current then, not the
 * one that was valid when the page first loaded.
 */
export function connectNotificationSocket(getToken: () => string | null): Socket {
  return io(SOCKET_BASE, {
    path: '/socket.io',
    auth: (cb) => cb({ token: getToken() }),
    // Both transports allowed (default) — long-polling first, upgrading to
    // WebSocket when available, so a network that blocks WebSocket upgrades
    // still gets realtime-ish delivery instead of failing outright.
    reconnection: true,
  });
}
