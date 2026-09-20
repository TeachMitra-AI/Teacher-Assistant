// The plan list for Billing (Teacher Basic / Teacher Pro) — see
// docs/payment-decisions.md and docs/payment-implementation-phases.md.
//
// Two plans only. "Teacher Basic" is the free plan and is the ABSENCE of a
// Subscription row; "Teacher Pro" is the one plan an admin can grant (and, in a
// later phase, a teacher can buy). Nothing here reads a database or the
// clock: the environment is passed in, so every function is pure and testable.
//
// Phase 1 only REPORTS these limits (GET /api/auth/me). No route enforces or
// counts them yet — that starts in Phase 2/3. A limit of `null` means
// unlimited.
//
// Every number comes from the environment with a safe default, and a bad value
// warns and falls back rather than crashing (same rule as lib/config.js and
// lib/flags.js). Changing a limit therefore never needs a code change.

const { parseIntEnv } = require('./config');
const { parseListEnv } = require('./flags');
const { APP_ROLES } = require('./roles');

const PLAN_KEYS = Object.freeze({
  BASIC: 'teacher_basic',
  PRO: 'teacher_pro',
});

// The only plan an admin can grant. Basic is never stored.
const GRANTABLE_PLAN_KEYS = Object.freeze([PLAN_KEYS.PRO]);

const BILLING_CONFIG_DEFAULTS = Object.freeze({
  // Days Pro keeps working after its end date, before dropping to Basic.
  graceDays: 3,
  basicMaxClasses: 2,
  basicQuestionsPerMonth: 50,
  basicImagesPerMonth: 10,
  basicPdfsPerMonth: 5,
  // Roles never limited by a plan. super_admin only: school_admin and
  // resource_person are treated like ordinary teachers (they can be added here
  // through BILLING_EXEMPT_ROLES if that is ever wanted).
  exemptRoles: Object.freeze(['super_admin']),
});

const GRACE_DAYS_BOUNDS = Object.freeze({ min: 0, max: 30 });
const LIMIT_BOUNDS = Object.freeze({ min: 0, max: 100000 });

/**
 * Read the billing numbers from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{
 *   graceDays: number,
 *   exemptRoles: string[],
 *   basicLimits: {classes: number, questionsPerMonth: number, imagesPerMonth: number, pdfsPerMonth: number},
 * }}
 */
function readBillingConfig(env, { warn = console.warn } = {}) {
  const limit = (name, defaultValue) =>
    parseIntEnv(env[name], { name, defaultValue, min: LIMIT_BOUNDS.min, max: LIMIT_BOUNDS.max, warn });

  const requestedRoles = parseListEnv(env.BILLING_EXEMPT_ROLES, {
    name: 'BILLING_EXEMPT_ROLES',
    defaultValue: BILLING_CONFIG_DEFAULTS.exemptRoles,
  });
  let exemptRoles = requestedRoles.filter((role) => {
    const known = APP_ROLES.includes(role);
    if (!known) warn(`[billing] BILLING_EXEMPT_ROLES entry "${role}" is not a known role; ignoring it.`);
    return known;
  });
  // A list that was only typos must not silently leave nobody exempt.
  if (exemptRoles.length === 0) exemptRoles = [...BILLING_CONFIG_DEFAULTS.exemptRoles];

  return {
    graceDays: parseIntEnv(env.BILLING_GRACE_DAYS, {
      name: 'BILLING_GRACE_DAYS',
      defaultValue: BILLING_CONFIG_DEFAULTS.graceDays,
      min: GRACE_DAYS_BOUNDS.min,
      max: GRACE_DAYS_BOUNDS.max,
      warn,
    }),
    exemptRoles,
    basicLimits: {
      classes: limit('BILLING_BASIC_MAX_CLASSES', BILLING_CONFIG_DEFAULTS.basicMaxClasses),
      questionsPerMonth: limit('BILLING_BASIC_QUESTIONS_PER_MONTH', BILLING_CONFIG_DEFAULTS.basicQuestionsPerMonth),
      imagesPerMonth: limit('BILLING_BASIC_IMAGES_PER_MONTH', BILLING_CONFIG_DEFAULTS.basicImagesPerMonth),
      pdfsPerMonth: limit('BILLING_BASIC_PDFS_PER_MONTH', BILLING_CONFIG_DEFAULTS.basicPdfsPerMonth),
    },
  };
}

/**
 * What a plan allows. Returns fresh objects each call, so a caller can never
 * mutate a shared definition by accident.
 * @param {string} planKey PLAN_KEYS.BASIC or PLAN_KEYS.PRO
 * @param {ReturnType<typeof readBillingConfig>} config
 */
function getPlanDefinition(planKey, config) {
  if (planKey === PLAN_KEYS.PRO) {
    return {
      planKey: PLAN_KEYS.PRO,
      features: { reportDownloads: true, classroomMode: true, lessonPlans: true },
      limits: { questionsPerMonth: null, classes: null, imagesPerMonth: null, pdfsPerMonth: null },
    };
  }
  return {
    planKey: PLAN_KEYS.BASIC,
    features: { reportDownloads: false, classroomMode: false, lessonPlans: false },
    limits: { ...config.basicLimits },
  };
}

module.exports = {
  PLAN_KEYS,
  GRANTABLE_PLAN_KEYS,
  BILLING_CONFIG_DEFAULTS,
  readBillingConfig,
  getPlanDefinition,
};
