// Thin wrapper over socket.io-client for realtime notifications; used only by components/Notifications.tsx (docs/notification-system-plan.md).
import { io, type Socket } from 'socket.io-client';
import { SOCKET_BASE } from '../config';

/**
 * Opens a connection authenticated via `auth.token` (Bearer-only, like api.ts). `getToken` is called on every (re)connect,
 * not once, since the 15-minute access token rotates and a socket reconnecting hours later must present the current one.
 */
export function connectNotificationSocket(getToken: () => string | null): Socket {
  return io(SOCKET_BASE, {
    path: '/socket.io',
    auth: (cb) => cb({ token: getToken() }),
    // Both transports allowed: long-polling first, upgrading to WebSocket, so a network that blocks upgrades still works.
    reconnection: true,
  });
}
