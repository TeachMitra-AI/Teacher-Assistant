// Socket.IO wiring for realtime notification delivery (docs/notification-system-plan.md). Minimal: one room per
// user (`user:<id>`) and an in-memory connected-user set for observability. State is per process and resets on
// restart, as with assistant/budget.js, assistant/breaker.js and rendering/cache.js; there's no Redis pub/sub
// because the app runs a single instance today (see index.js's `trust proxy` note). Revisit before going multi-instance.
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

  // userId -> Set<socket.id>. A user can have several live sockets (two tabs, desktop plus mobile) and all receive the emit.
  const socketsByUser = new Map();

  // The gate. NOTIFICATIONS_ENABLED off rejects every handshake, matching the REST routes' gate, so a disabled
  // deployment has no realtime surface. `isEnabled()` is read on every handshake, not once at boot, so flipping
  // the flag takes effect without a restart.
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
    // Fire-and-forget: a user with no live socket has no room, the normal offline case. The caller never awaits this.
    io.to(`user:${userId}`).emit(event, payload);
  }

  function connectedUserCount() {
    return socketsByUser.size;
  }

  return { io, emitToUser, connectedUserCount };
}

module.exports = { initSocketServer };
