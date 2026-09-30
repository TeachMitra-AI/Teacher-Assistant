// The single choke point for sending notifications: the REST send route (routes/notifications.js) and every
// system/AI call site (e.g. routes/resources.js on a saved resource). See docs/notification-system-plan.md.
const { prisma } = require('./db');
const { schoolScope } = require('./notificationScope');
// Referenced as `pushService.dispatchPush(...)`, never destructured, so tests can `vi.spyOn` it without module mocking.
const pushService = require('./pushService');

// Hard ceiling on one broadcast's recipients: a safety rail against a fat-fingered "send to all", not a tunable cost control.
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
 * Creates one notification for one recipient, persists it, and best-effort emits it on their live socket.
 * A socket failure never throws or rolls back the write; the recipient still sees it via GET /api/notifications.
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

  // OS-level push, best-effort alongside the realtime emit. dispatchPush shouldn't throw, but the try/catch keeps a
  // bug in that contract from failing a write already committed. A no-op when MOBILE_PUSH_ENABLED is off or no device is registered.
  try {
    await pushService.dispatchPush([input.recipientId], toDto(row));
  } catch (err) {
    console.error('[notifications] push dispatch failed', { message: err.message });
  }

  return row;
}

/**
 * Resolves a validated send target into eligible recipient ids, clamped to the sender's schoolScope(); the
 * request body's schoolIds/userIds are never trusted beyond that intersection. An out-of-scope id matches zero rows.
 *
 * @param {{ id: string, role: string, schoolId: string }} sender
 * @param {{ scope: 'all'|'school'|'role'|'users', schoolIds?: string[], roles?: string[], userIds?: string[] }} target
 * @returns {Promise<string[]>}
 */
async function resolveRecipients(sender, target) {
  const allowedSchoolIds = await schoolScope(sender); // null = every school (super_admin only)

  if (target.scope === 'all' && sender.role !== 'super_admin') {
    // A non-super_admin never gets platform-wide scope: their own schoolScope() stands in for "all", so
    // a school_admin's "Send to all" means everyone they can see.
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
 * Sends one notification to many recipients in a single createMany INSERT, then best-effort emits to whoever is online.
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
    // createMany() doesn't return ids on SQLite/Prisma, and the client needs real ids, so one SELECT on this batch's exact `createdAt` fetches them.
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

  // OS-level push for the whole batch in one dispatch, best-effort like createNotification's. A broadcast has no
  // per-recipient notification id, so `id` is null; every recipient gets the same title/message/link, which is all tap-to-navigate needs.
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
