// Entitlements: "which plan does this user have right now, and what does it
// allow?" — see docs/payment-implementation-phases.md (Phase 1, section 6.7).
//
// The decision itself (resolveEntitlements) is a PURE function: the user's
// role, their subscription rows, the current time and the settings are all
// passed in, so a test can use any date without waiting for it. Only
// getUserEntitlements touches the database, and only to read.
//
// The plan is always read from the database, never from the login token: the
// token lives up to 15 minutes, so a plan in it would be stale right after a
// purchase or an expiry.
//
// Phase 1 only REPORTS entitlements (GET /api/auth/me). Nothing is blocked or
// counted by them yet.

const { readBillingFlags } = require('./flags');
const { PLAN_KEYS, readBillingConfig, getPlanDefinition } = require('./plans');

const STATES = Object.freeze({
  BASIC: 'basic', // no running Pro
  ACTIVE: 'active', // Pro, before its end date
  GRACE: 'grace', // Pro, past its end date but inside the grace days
  EXEMPT: 'exempt', // a role that is never limited
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Add whole calendar months in UTC, keeping the end of the month correct
 * (31 Jan + 1 month is the last day of February, not early March).
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTargetMonth));
  return result;
}

/**
 * Decide a user's entitlements at a moment in time. Pure.
 *
 * Only the running Pro row that ends LAST counts (one running row per user is
 * enforced when it is written, but this stays correct if history has several).
 * `startsAt` is a record only and does not gate anything: no code path creates
 * a future-dated row.
 *
 * @param {{
 *   role: string,
 *   subscriptions: Array<{status: string, planKey: string, endsAt: Date}>,
 *   now: Date,
 *   config: ReturnType<typeof readBillingConfig>,
 * }} input
 */
function resolveEntitlements({ role, subscriptions, now, config }) {
  if (config.exemptRoles.includes(role)) {
    return {
      ...getPlanDefinition(PLAN_KEYS.PRO, config),
      state: STATES.EXEMPT,
      endsAt: null,
      graceEndsAt: null,
    };
  }

  const latest = subscriptions
    .filter((s) => s.status === 'active' && s.planKey === PLAN_KEYS.PRO)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];

  if (latest) {
    const graceEndsAt = new Date(latest.endsAt.getTime() + config.graceDays * DAY_MS);
    if (now.getTime() < latest.endsAt.getTime()) {
      return {
        ...getPlanDefinition(PLAN_KEYS.PRO, config),
        state: STATES.ACTIVE,
        endsAt: latest.endsAt,
        graceEndsAt,
      };
    }
    if (now.getTime() < graceEndsAt.getTime()) {
      return {
        ...getPlanDefinition(PLAN_KEYS.PRO, config),
        state: STATES.GRACE,
        endsAt: latest.endsAt,
        graceEndsAt,
      };
    }
  }

  return {
    ...getPlanDefinition(PLAN_KEYS.BASIC, config),
    state: STATES.BASIC,
    endsAt: null,
    graceEndsAt: null,
  };
}

/**
 * Read the user's subscription and resolve their entitlements.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{id: string, role: string}} user
 * @param {{now?: Date, env?: Record<string, string|undefined>}} [opts]
 */
async function getUserEntitlements(db, user, { now = new Date(), env = process.env } = {}) {
  const config = readBillingConfig(env);
  // An exempt role never needs a database read.
  if (config.exemptRoles.includes(user.role)) {
    return resolveEntitlements({ role: user.role, subscriptions: [], now, config });
  }
  const subscriptions = await db.subscription.findMany({
    where: { userId: user.id, status: 'active' },
    orderBy: { endsAt: 'desc' },
    take: 1,
  });
  return resolveEntitlements({ role: user.role, subscriptions, now, config });
}

/**
 * The shape shown to clients (GET /api/auth/me). Dates become ISO strings; a
 * limit of null means unlimited.
 */
function toBillingSummary(entitlements) {
  return {
    plan: entitlements.planKey,
    state: entitlements.state,
    endsAt: entitlements.endsAt ? entitlements.endsAt.toISOString() : null,
    graceEndsAt: entitlements.graceEndsAt ? entitlements.graceEndsAt.toISOString() : null,
    features: entitlements.features,
    limits: entitlements.limits,
  };
}

/**
 * The billing block for GET /api/auth/me, or null.
 *
 * Returns null when billing is off (so the response is exactly what it was
 * before billing existed) AND when anything at all goes wrong. /me is the call
 * every client makes to know who is signed in; a billing problem must never
 * take it down. In Phase 1 this block is display-only, so leaving it out is the
 * safe failure.
 */
async function getBillingSummaryForMe(db, user, { now, env = process.env } = {}) {
  try {
    if (!readBillingFlags(env).enabled) return null;
    return toBillingSummary(await getUserEntitlements(db, user, { now, env }));
  } catch (err) {
    console.error('[billing] could not build the billing summary', { message: err.message });
    return null;
  }
}

module.exports = {
  STATES,
  addMonths,
  resolveEntitlements,
  getUserEntitlements,
  toBillingSummary,
  getBillingSummaryForMe,
};
