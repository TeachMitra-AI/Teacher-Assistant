// Notification System (docs/notification-system-plan.md): every /api/notifications* route.
// Every route touches only the caller's own notifications (WHERE recipientId === req.user.id, enforced in the query, not
// checked after fetching); a notification is inbox-private. The exception is POST, which creates notifications for
// others but never reads them back.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { isUniqueConstraintError, isRecordNotFoundError } = require('../lib/prismaErrors');
const { authRequired, requireRole } = require('../middleware/auth');
const { readNotificationsFlags, readMobilePushFlags } = require('../lib/flags');
const { ADMIN_SENDABLE_TYPES } = require('../lib/notificationTypes');
const { APP_ROLES } = require('../lib/roles');
const { createBroadcast, toDto } = require('../lib/notificationService');

const router = express.Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;

function parseListQuery(query) {
  const rawLimit = parseInt(query.limit, 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_PAGE_SIZE : rawLimit, 1), MAX_PAGE_SIZE);
  const rawPage = parseInt(query.page, 10);
  const page = Math.max(Number.isNaN(rawPage) ? 1 : rawPage, 1);
  return { limit, page, skip: (page - 1) * limit };
}

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

/**
 * Gate middleware, like routes/support.js's requireHelpSupportEnabled: runs before any work, so a disabled deployment
 * never touches the database. The Socket.IO handshake is gated separately in lib/socketServer.js.
 */
function requireNotificationsEnabled() {
  return (req, res, next) => {
    const flags = readNotificationsFlags(process.env);
    if (!flags.enabled) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'NOTIFICATIONS_DISABLED' });
    }
    return next();
  };
}

/**
 * Gate for the device-token routes: a separate flag layered on NOTIFICATIONS_ENABLED (see readMobilePushFlags in
 * lib/flags.js). With MOBILE_PUSH_ENABLED off, no token is persisted and no Expo call is made.
 */
function requireMobilePushEnabled() {
  return (req, res, next) => {
    const flags = readMobilePushFlags(process.env);
    if (!flags.enabled) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'MOBILE_PUSH_DISABLED' });
    }
    return next();
  };
}

// GET /api/notifications — the caller's own notifications, newest first.
router.get('/notifications', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const { limit, page, skip } = parseListQuery(req.query);

  const [total, rows] = await Promise.all([
    prisma.notification.count({ where: { recipientId: req.user.id } }),
    prisma.notification.findMany({
      where: { recipientId: req.user.id },
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
    }),
  ]);

  res.json({ notifications: rows.map(toDto), total, page, limit });
}));

// GET /api/notifications/unread-count: cheap indexed count for the badge. Register before the `:id` routes so
// "unread-count" isn't captured as an :id (as with /tickets/stats in adminSupport.js).
router.get('/notifications/unread-count', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({ where: { recipientId: req.user.id, read: false } });
  res.json({ count });
}));

// PATCH /api/notifications/read-all: marks the caller's unread notifications read in one updateMany. Register before /:id/read.
router.patch('/notifications/read-all', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { recipientId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  res.json({ updated: result.count });
}));

// PATCH /api/notifications/:id/read: marks one of the caller's own notifications read. Someone else's id 404s, never 403s.
router.patch('/notifications/:id/read', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, recipientId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  if (result.count === 0) {
    // A notification that doesn't exist or isn't the caller's is a 404; one already read is a harmless no-op, not an error.
    const exists = await prisma.notification.findFirst({
      where: { id: req.params.id, recipientId: req.user.id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: 'Notification not found.' });
  }
  res.json({ id: req.params.id, read: true });
}));

// Device tokens (OS-level push)

const DEVICE_TOKEN_PLATFORMS = ['ios', 'android'];

const deviceTokenSchema = z.object({
  // Expo push tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"; 200 is a generous ceiling, not a measured length.
  token: z.string().trim().min(10).max(200),
  platform: z.enum(DEVICE_TOKEN_PLATFORMS),
});

// POST /api/notifications/device-tokens: register (or re-register) the caller's own device token. It upserts on
// `token`, not [userId, token]: a token identifies one installation, so one already on file (app restart, or the
// same device on another account) is reassigned to the registering user instead of duplicated.
router.post(
  '/notifications/device-tokens',
  authRequired,
  requireMobilePushEnabled(),
  asyncHandler(async (req, res) => {
    const parsed = deviceTokenSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid device token.' });
    }
    const { token, platform } = parsed.data;
    const upsertArgs = {
      where: { token },
      update: { userId: req.user.id, platform, lastSeenAt: new Date() },
      create: { userId: req.user.id, token, platform },
    };

    let row;
    try {
      row = await prisma.deviceToken.upsert(upsertArgs);
    } catch (err) {
      // Prisma's upsert isn't atomic: two concurrent registrations of the same token can both miss the update and hit the
      // unique constraint on insert. The winner's row already covers this token, so a retry succeeds through the update branch.
      if (!isUniqueConstraintError(err)) throw err;
      row = await prisma.deviceToken.upsert(upsertArgs);
    }

    res.status(201).json({ id: row.id });
  })
);

// DELETE /api/notifications/device-tokens/:token: unregister one of the caller's own tokens (logout). A token that
// exists but isn't the caller's 404s, so it can't be used to guess whether another user's device is registered.
router.delete(
  '/notifications/device-tokens/:token',
  authRequired,
  requireMobilePushEnabled(),
  asyncHandler(async (req, res) => {
    const existing = await prisma.deviceToken.findUnique({ where: { token: req.params.token } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Device token not found.' });
    }
    try {
      await prisma.deviceToken.delete({ where: { token: req.params.token } });
    } catch (err) {
      // A concurrent delete (e.g. a double logout) between the check and this delete leaves the row already gone, same as the not-found case.
      if (!isRecordNotFoundError(err)) throw err;
      return res.status(404).json({ error: 'Device token not found.' });
    }
    res.json({ success: true });
  })
);

// Sending (school_admin / resource_person / super_admin only)

const targetSchema = z.object({
  scope: z.enum(['all', 'school', 'role', 'users']),
  schoolIds: z.array(z.string()).max(500).optional(),
  roles: z.array(z.enum(APP_ROLES)).max(APP_ROLES.length).optional(),
  userIds: z.array(z.string()).max(5000).optional(),
});

const sendSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  type: z.enum(ADMIN_SENDABLE_TYPES),
  // Relative in-app path only — never an absolute URL (see schema.prisma's
  // Notification.link doc comment).
  link: z.string().trim().max(200).regex(/^\/[^\s]*$/).optional(),
  target: targetSchema,
});

// POST /api/notifications: send or broadcast. Scope is re-derived server-side from the caller's role in
// createBroadcast()/resolveRecipients(); the body's target is a request, not a grant. A teacher never gets here
// (requireRole returns 403).
router.post(
  '/notifications',
  authRequired,
  requireRole('school_admin', 'resource_person', 'super_admin'),
  requireNotificationsEnabled(),
  asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid notification.' });
    }
    const { title, message, type, link, target } = parsed.data;

    const sender = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, role: true, schoolId: true, name: true, displayName: true },
    });
    if (!sender) return res.status(401).json({ error: 'Authentication required.' });

    const { recipientCount } = await createBroadcast(
      {
        sender: { id: sender.id, role: sender.role, schoolId: sender.schoolId },
        senderName: sender.displayName || sender.name,
        senderRole: sender.role,
        target,
        type,
        title,
        message,
        link: link || null,
      },
      req.app.locals.socketServer
    );

    console.log('[notifications] broadcast_sent', {
      senderId: sender.id, senderRole: sender.role, type, targetScope: target.scope, recipientCount,
    });

    res.status(201).json({ success: true, recipientCount });
  })
);

module.exports = router;
