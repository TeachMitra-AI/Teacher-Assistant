// Socket.IO wiring for realtime notification delivery — the ONE new runtime
// dependency this feature adds (see docs/notification-system-plan.md §5: no
// realtime layer existed anywhere in this codebase before this feature).
//
// Deliberately minimal: one room per user (`user:<id>`), an in-memory
// connected-user set for observability, and nothing else. Same
// in-memory/per-process/resets-on-restart tradeoff this codebase already
// accepts for assistant/budget.js, assistant/breaker.js and
// learningRepresentation/rendering/cache.js — there is no Redis pub/sub here
// because this app runs a single Railway instance today (see index.js's
// `trust proxy` comment); revisit BEFORE scaling to multiple instances, not
// after, same caveat those modules already state for their own state.
const { Server } = require('socket.io');
const { decode } = require('../middleware/auth');

/**
 * @param {import('http').Server} httpServer
 * @param {{ isOriginAllowed: (origin: string|undefined) => boolean, isEnabled: () => boolean }} opts
 * @returns {{ io: import('socket.io').Server, emitToUser: (userId: string, event: string, payload: unknown) => void, connectedUserCount: () => number }}
 */
function initSocketServer(httpServer, { isOriginAllowed, isEnabled }) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST'],
    },
  });

  // userId -> Set<socket.id>. A user can have more than one live socket (two
  // tabs, or desktop + mobile), so this is a set, not a single value — every
  // member of it receives the emit.
  const socketsByUser = new Map();

  // The gate. NOTIFICATIONS_ENABLED off rejects every handshake — matching
  // the REST routes' own requireNotificationsEnabled() gate, so a disabled
  // deployment has ZERO realtime surface, not just an inert REST API.
  // `isEnabled()` is called FRESH on every handshake, not read once at boot
  // — same "read the env var live" discipline every other feature flag in
  // this app follows (lib/flags.js), and the reason flipping
  // NOTIFICATIONS_ENABLED is a real, immediately-effective kill switch
  // rather than one that needs a process restart to take hold.
  io.use((socket, next) => {
    if (!isEnabled()) return next(new Error('Notifications are not enabled.'));
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required.'));
    try {
      socket.user = decode(token);
      return next();
    } catch {
      return next(new Error('Invalid or expired session.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);

    if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
    socketsByUser.get(userId).add(socket.id);

    socket.on('disconnect', () => {
      const set = socketsByUser.get(userId);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) socketsByUser.delete(userId);
    });
  });

  function emitToUser(userId, event, payload) {
    // Best-effort, fire-and-forget — a user with no live socket simply has
    // no room to receive this, which is the normal "offline" case, not an
    // error. The caller (notificationService.js) never awaits this.
    io.to(`user:${userId}`).emit(event, payload);
  }

  function connectedUserCount() {
    return socketsByUser.size;
  }

  return { io, emitToUser, connectedUserCount };
}

module.exports = { initSocketServer };
