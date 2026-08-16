// Notification System — see docs/notification-system-plan.md.
//
// SCOPE: this file owns every /api/notifications* route. Every route only
// ever touches the CALLER's own notifications (WHERE recipientId ===
// req.user.id, enforced in the query itself, never just checked after
// fetching) — a notification is inbox-private, same as SupportNote is
// submitter-private in routes/adminSupport.js. The one exception is POST,
// which CREATES notifications for other users but never reads them back.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { readNotificationsFlags } = require('../lib/flags');
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
 * Gate middleware — same shape as routes/support.js's
 * requireHelpSupportEnabled: runs before any work is done, so a disabled
 * deployment never touches the database and the Socket.IO handshake (gated
 * independently in lib/socketServer.js) has the matching REST-side twin.
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

// GET /api/notifications/unread-count — cheap, indexed count for the badge.
// MUST be registered before /notifications/:id-shaped routes below so
// "unread-count" is never captured as an :id — mirrors
// routes/adminSupport.js's /tickets/stats-before-/tickets/:id ordering.
router.get('/notifications/unread-count', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({ where: { recipientId: req.user.id, read: false } });
  res.json({ count });
}));

// PATCH /api/notifications/read-all — marks every unread notification of the
// caller's read in one updateMany. Registered before /:id/read so "read-all"
// is never matched by that route's :id segment.
router.patch('/notifications/read-all', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { recipientId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  res.json({ updated: result.count });
}));

// PATCH /api/notifications/:id/read — marks one of the CALLER'S OWN
// notifications read. A second user's id 404s rather than 403ing, so this
// never confirms whether a given id belongs to someone else.
router.patch('/notifications/:id/read', authRequired, requireNotificationsEnabled(), asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, recipientId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  if (result.count === 0) {
    // Either it doesn't exist, isn't the caller's, or was already read —
    // the last case isn't an error (marking an already-read notification
    // read again is a harmless no-op from the client's perspective), so
    // only 404 when the row genuinely isn't the caller's to mark.
    const exists = await prisma.notification.findFirst({
      where: { id: req.params.id, recipientId: req.user.id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: 'Notification not found.' });
  }
  res.json({ id: req.params.id, read: true });
}));

// ---- Sending (school_admin / resource_person / super_admin only) ----------

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

// POST /api/notifications — send/broadcast. Scope is re-derived server-side
// from the caller's own role inside createBroadcast()/resolveRecipients() —
// the request body's target is a REQUEST, not a grant (see
// docs/notification-system-plan.md §7). A teacher never reaches this route
// at all: requireRole rejects them with 403 before the handler runs.
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
