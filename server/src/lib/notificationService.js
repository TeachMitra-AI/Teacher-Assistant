// The single choke point every notification send path goes through — the
// REST send route (routes/notifications.js), and every system/AI call site
// elsewhere in the server (e.g. routes/resources.js on a saved resource).
// Centralizing this is what docs/notification-system-plan.md §6 means by
// "don't scatter notification-creation logic across route handlers" — a
// future Web Push dispatch is one more call inside createNotification(),
// not a change at every call site.
const { prisma } = require('./db');
const { schoolScope } = require('./notificationScope');
// Referenced as `pushService.dispatchPush(...)` throughout this file, never
// destructured — that keeps the call sites test-spyable (`vi.spyOn(pushService,
// 'dispatchPush')`) without any module-mocking machinery, matching this
// module's existing "pass dependencies in, don't hide them behind a mock"
// style (see socketServer, already a plain parameter on both functions below).
const pushService = require('./pushService');

// Hard ceiling on a single broadcast's recipient count. Not a tunable env var
// (unlike the AI-feature budgets elsewhere in lib/flags.js) — this is a
// safety rail against a fat-fingered "send to all" on a future, much larger
// deployment, not a cost control, so a fixed constant is the right shape.
const MAX_BROADCAST_RECIPIENTS = 5000;

function toDto(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    read: row.read,
    createdAt: row.createdAt,
    senderName: row.senderName,
    senderRole: row.senderRole,
    metadata: row.metadata ? safeParseMetadata(row.metadata) : null,
  };
}

function safeParseMetadata(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Creates one notification for one recipient, persists it, and best-effort
 * emits it over the recipient's live socket (if any). Never throws on the
 * emit half — a socket-layer failure must never roll back a write the
 * recipient will still see on next page load / GET /api/notifications.
 *
 * @param {object} input
 * @param {string} input.recipientId
 * @param {string} input.type
 * @param {string} input.title
 * @param {string} input.message
 * @param {string|null} [input.link]
 * @param {string|null} [input.senderId]
 * @param {string|null} [input.senderName]
 * @param {string|null} [input.senderRole]
 * @param {object|null} [input.metadata]
 * @param {{ emitToUser: (userId: string, event: string, payload: unknown) => void }|null} [socketServer]
 */
async function createNotification(input, socketServer = null) {
  const row = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      senderId: input.senderId ?? null,
      senderName: input.senderName ?? null,
      senderRole: input.senderRole ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  if (socketServer) {
    try {
      socketServer.emitToUser(input.recipientId, 'notification:new', toDto(row));
    } catch (err) {
      console.error('[notifications] realtime emit failed', { message: err.message });
    }
  }

  // Phase 7b: OS-level push, additive alongside the realtime emit above.
  // pushService.dispatchPush() already contracts to never throw, but this is
  // wrapped defensively anyway — same belt-and-suspenders shape as the
  // socketServer emit above — so a bug in that contract can never turn into
  // a failed write the caller already committed to. A no-op when
  // MOBILE_PUSH_ENABLED is off (the default) or the recipient has no
  // registered device.
  try {
    await pushService.dispatchPush([input.recipientId], toDto(row));
  } catch (err) {
    console.error('[notifications] push dispatch failed', { message: err.message });
  }

  return row;
}

/**
 * Resolves a validated send target into the list of eligible recipient user
 * ids, CLAMPED to the sender's own schoolScope() — never trusting the
 * request body's schoolIds/userIds beyond that intersection (see
 * docs/notification-system-plan.md §7). Degrades gracefully on an
 * out-of-scope id (matches zero rows) rather than erroring, same convention
 * routes/adminSupport.js's filters already use for bad filter input.
 *
 * @param {{ id: string, role: string, schoolId: string }} sender
 * @param {{ scope: 'all'|'school'|'role'|'users', schoolIds?: string[], roles?: string[], userIds?: string[] }} target
 * @returns {Promise<string[]>}
 */
async function resolveRecipients(sender, target) {
  const allowedSchoolIds = await schoolScope(sender); // null = every school (super_admin only)

  if (target.scope === 'all' && sender.role !== 'super_admin') {
    // A non-super_admin can never reach platform-wide scope. Their own
    // schoolScope() stands in for "all" instead of rejecting outright, so a
    // school_admin's "Send to all" (meaning: everyone I can see) still works
    // as their own maximum scope.
    target = { scope: 'school', schoolIds: allowedSchoolIds || [] };
  }

  const where = { status: 'active' };

  if (target.scope === 'all') {
    // super_admin only, reached above. No schoolId filter at all.
  } else if (target.scope === 'school') {
    const requested = Array.isArray(target.schoolIds) ? target.schoolIds : [];
    const inScope = allowedSchoolIds === null ? requested : requested.filter((id) => allowedSchoolIds.includes(id));
    if (inScope.length === 0) return [];
    where.schoolId = { in: inScope };
  } else if (target.scope === 'role') {
    where.schoolId = allowedSchoolIds === null ? undefined : { in: allowedSchoolIds };
    const roles = Array.isArray(target.roles) ? target.roles : [];
    if (roles.length === 0) return [];
    where.role = { in: roles };
  } else if (target.scope === 'users') {
    const requested = Array.isArray(target.userIds) ? target.userIds : [];
    if (requested.length === 0) return [];
    where.id = { in: requested };
    where.schoolId = allowedSchoolIds === null ? undefined : { in: allowedSchoolIds };
  } else {
    return [];
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true },
    take: MAX_BROADCAST_RECIPIENTS,
  });
  return users.map((u) => u.id);
}

/**
 * Sends one notification to many recipients in a single INSERT
 * (createMany), then best-effort emits to whichever of them are online.
 *
 * @param {object} input
 * @param {{ id: string, role: string, schoolId: string }} input.sender
 * @param {string} input.senderName
 * @param {string} input.senderRole
 * @param {{ scope: string, schoolIds?: string[], roles?: string[], userIds?: string[] }} input.target
 * @param {string} input.type
 * @param {string} input.title
 * @param {string} input.message
 * @param {string|null} [input.link]
 * @param {{ emitToUser: (userId: string, event: string, payload: unknown) => void }|null} [socketServer]
 * @returns {Promise<{ recipientCount: number }>}
 */
async function createBroadcast(input, socketServer = null) {
  const recipientIds = await resolveRecipients(input.sender, input.target);
  if (recipientIds.length === 0) return { recipientCount: 0 };

  const createdAt = new Date();
  await prisma.notification.createMany({
    data: recipientIds.map((recipientId) => ({
      recipientId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      senderId: input.sender.id,
      senderName: input.senderName,
      senderRole: input.senderRole,
      createdAt,
    })),
  });

  if (socketServer) {
    // createMany() doesn't return the created rows' ids (SQLite/Prisma), and
    // the client needs a real id to key the row and to later call
    // PATCH /:id/read — so one bulk SELECT keyed on the exact `createdAt`
    // this batch just wrote fetches them back. Still one INSERT + one SELECT
    // for the whole broadcast, not N round trips.
    const created = await prisma.notification.findMany({
      where: { recipientId: { in: recipientIds }, createdAt },
      select: { id: true, recipientId: true },
    });
    for (const row of created) {
      try {
        socketServer.emitToUser(row.recipientId, 'notification:new', {
          id: row.id,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link ?? null,
          read: false,
          createdAt,
          senderName: input.senderName,
          senderRole: input.senderRole,
          metadata: null,
        });
      } catch (err) {
        console.error('[notifications] broadcast emit failed', { message: err.message });
      }
    }
  }

  // Phase 7b: OS-level push for the whole batch in one dispatch call — same
  // additive, best-effort shape as createNotification()'s call, defensively
  // try/caught for the same belt-and-suspenders reason (see that function's
  // comment). Unlike the realtime emit (which needs each row's own id to key
  // the client-side list), a broadcast's push payload has no single
  // per-recipient notification id to attach, so `id` is left null; every
  // recipient still gets the SAME title/message/link, which is all
  // NotificationsScreen's tap-to-navigate (the `link` field) needs.
  try {
    await pushService.dispatchPush(recipientIds, {
      id: null,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    });
  } catch (err) {
    console.error('[notifications] broadcast push dispatch failed', { message: err.message });
  }

  return { recipientCount: recipientIds.length };
}

module.exports = { createNotification, createBroadcast, resolveRecipients, toDto, MAX_BROADCAST_RECIPIENTS };
