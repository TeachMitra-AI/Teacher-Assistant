// Billing (Phase 1) — a super_admin gives, looks up and removes a teacher's Pro
// plan by hand. See docs/payment-implementation-phases.md (section 6.8).
//
// SCOPE: every /api/admin/subscriptions/* route. Kept in its own file, like
// routes/adminSupport.js: these routes are super_admin-only, full stop, and are
// not role-scoped the way routes/admin.js is.
//
// This is how testers and pilots get Pro before any payment exists. Nothing
// here charges anyone, and nothing in Phase 1 blocks or limits a user because
// of a plan — see lib/entitlements.js.
//
// Order of the gate is the app's usual one: not signed in (401), wrong role
// (403), THEN the feature switch (503). With BILLING_ENABLED off every route
// here answers 503 and touches no table.
//
// Rules:
//   - one running Pro row per user, enforced here inside a transaction (Prisma
//     cannot express "unique among active rows"): granting again while Pro is
//     still running ADDS months to its end date; granting once it has ended
//     (or is only in grace) starts fresh from now
//   - every change writes an Event row in the same transaction
//   - request bodies are Zod .strict(): unknown fields are rejected
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { readBillingFlags } = require('../lib/flags');
const { GRANTABLE_PLAN_KEYS } = require('../lib/plans');
const { addMonths, getUserEntitlements, toBillingSummary } = require('../lib/entitlements');

const router = express.Router();

const MAX_ID_LENGTH = 60;
const MAX_NOTE_LENGTH = 500;
const MIN_MONTHS = 1;
const MAX_MONTHS = 36;
const MAX_LISTED_ROWS = 50;

const grantSchema = z
  .object({
    userId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    planKey: z.enum(GRANTABLE_PLAN_KEYS),
    months: z.number().int().min(MIN_MONTHS).max(MAX_MONTHS),
    note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();

const lookupQuerySchema = z.object({ userId: z.string().trim().min(1).max(MAX_ID_LENGTH) }).strict();

function requireBillingEnabled(req, res, next) {
  if (!readBillingFlags(process.env).enabled) {
    return res.status(503).json({ error: 'This feature is not available right now.', code: 'BILLING_DISABLED' });
  }
  return next();
}

const gate = [authRequired, requireRole('super_admin'), requireBillingEnabled];

// Picked field by field so a row that was loaded with a relation (see revoke)
// can never leak that relation into a response.
function toDto(row) {
  return {
    id: row.id,
    userId: row.userId,
    planKey: row.planKey,
    status: row.status,
    source: row.source,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    grantedById: row.grantedById,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function notFoundError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// POST /api/admin/subscriptions — give a user Pro, or add months to a running one.
router.post('/', ...gate, asyncHandler(async (req, res) => {
  const parsed = grantSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  }
  const { userId, planKey, months, note } = parsed.data;
  const now = new Date();

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, email: true, schoolId: true },
      });
      if (!target) throw notFoundError('USER_NOT_FOUND');

      const running = await tx.subscription.findFirst({
        where: { userId, planKey, status: 'active', endsAt: { gt: now } },
        orderBy: { endsAt: 'desc' },
      });

      let subscription;
      let extended;
      if (running) {
        subscription = await tx.subscription.update({
          where: { id: running.id },
          data: { endsAt: addMonths(running.endsAt, months), ...(note ? { note } : {}) },
        });
        extended = true;
      } else {
        subscription = await tx.subscription.create({
          data: {
            userId,
            planKey,
            status: 'active',
            source: 'manual',
            startsAt: now,
            endsAt: addMonths(now, months),
            grantedById: req.user.id,
            ...(note ? { note } : {}),
          },
        });
        extended = false;
      }

      await tx.event.create({
        data: {
          userId: req.user.id, // the admin who made the change, not its subject
          schoolId: target.schoolId,
          type: extended ? 'subscription_extended' : 'subscription_granted',
          metadata: JSON.stringify({
            targetUserId: target.id,
            targetEmail: target.email,
            subscriptionId: subscription.id,
            planKey,
            months,
            endsAt: subscription.endsAt.toISOString(),
          }),
        },
      });

      return { subscription, extended, target };
    });
  } catch (err) {
    if (err.code === 'USER_NOT_FOUND') return res.status(404).json({ error: 'User not found.' });
    throw err;
  }

  const entitlements = await getUserEntitlements(prisma, { id: result.target.id, role: result.target.role }, { now });
  return res.status(result.extended ? 200 : 201).json({
    subscription: toDto(result.subscription),
    extended: result.extended,
    entitlements: toBillingSummary(entitlements),
  });
}));

// GET /api/admin/subscriptions?userId=… — a user's subscription rows and what
// the resolver makes of them right now. For support and testing.
router.get('/', ...gate, asyncHandler(async (req, res) => {
  const parsed = lookupQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ error: 'A userId is required.' });

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true },
  });
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const rows = await prisma.subscription.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_LISTED_ROWS,
  });
  const entitlements = await getUserEntitlements(prisma, target);
  return res.json({ subscriptions: rows.map(toDto), entitlements: toBillingSummary(entitlements) });
}));

// POST /api/admin/subscriptions/:id/revoke — end a row now. Repeating it is a
// harmless no-op (no second Event row).
router.post('/:id/revoke', ...gate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    return res.status(404).json({ error: 'Subscription not found.' });
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { id },
        include: { user: { select: { email: true, schoolId: true } } },
      });
      if (!existing) throw notFoundError('SUBSCRIPTION_NOT_FOUND');
      if (existing.status === 'revoked') return { subscription: existing };

      const subscription = await tx.subscription.update({ where: { id }, data: { status: 'revoked' } });
      await tx.event.create({
        data: {
          userId: req.user.id,
          schoolId: existing.user.schoolId,
          type: 'subscription_revoked',
          metadata: JSON.stringify({
            targetUserId: existing.userId,
            targetEmail: existing.user.email,
            subscriptionId: existing.id,
            planKey: existing.planKey,
          }),
        },
      });
      return { subscription };
    });
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_NOT_FOUND') return res.status(404).json({ error: 'Subscription not found.' });
    throw err;
  }

  return res.json({ subscription: toDto(result.subscription) });
}));

module.exports = router;
