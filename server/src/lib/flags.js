// Feature-flag parsing for the AI Action Router (Phase 1, Milestone M0).
//
// Deliberately mirrors lib/config.js: the helpers are PURE (the caller reads
// process.env and passes the raw string in), and an invalid value falls back to
// a known-safe default with a warning rather than crashing. Fail-fast is
// reserved for genuinely-required secrets (GEMINI_API_KEY, JWT_SECRET); a typo
// in a feature flag must never take the server down.
//
// The safe default for EVERY flag here is OFF. A deployment that sets none of
// these ships a completely inert assistant, which is the correct failure mode:
// forgetting to configure the feature can only under-enable it, never
// over-enable it.
//
// Note on where the kill switch really lives: the client is a PWA with
// service-worker caching (registerType 'autoUpdate'), so a client-side flag
// change propagates on some later page load rather than immediately. That makes
// ASSISTANT_ENABLED here the only reliable incident control — see the
// guardrails document, G28.

const { parseIntEnv } = require('./config');

// Accepted spellings, chosen to match what people actually type in a .env file.
// Anything else non-empty is a typo, not a value: it warns and uses the default
// rather than being silently coerced (a stray "ASSISTANT_ENABLED=ture" must not
// read as false-because-not-true when the default is false and the author
// clearly meant true — the warning is what surfaces it).
const TRUE_VALUES = ['true', '1', 'yes', 'on'];
const FALSE_VALUES = ['false', '0', 'no', 'off'];

/**
 * Parse an environment variable as a boolean.
 * - Missing/empty  → default (no warning; absence is normal and expected).
 * - Recognized     → the parsed value.
 * - Anything else  → default + warn.
 *
 * @param {string|undefined} rawValue the raw env string
 * @param {object} opts
 * @param {string} opts.name env var name, for warning messages
 * @param {boolean} opts.defaultValue
 * @param {(msg: string) => void} [opts.warn=console.warn]
 * @returns {boolean}
 */
function parseBoolEnv(rawValue, { name, defaultValue, warn = console.warn }) {
  if (rawValue == null || String(rawValue).trim() === '') {
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (TRUE_VALUES.includes(normalized)) return true;
  if (FALSE_VALUES.includes(normalized)) return false;

  warn(
    `[flags] ${name}="${rawValue}" is not a recognized boolean ` +
      `(${TRUE_VALUES.join('/')} or ${FALSE_VALUES.join('/')}); using default ${defaultValue}.`
  );
  return defaultValue;
}

/**
 * Parse an environment variable as a comma-separated list. Entries are trimmed
 * and empties dropped, so "a, b,, c" and "a,b,c" are the same list.
 *
 * An empty/missing value yields the default rather than an empty list, because
 * for these flags "unset" and "explicitly empty" mean the same thing and the
 * caller decides what an empty list signifies (for allow-lists here it means
 * "no restriction" — see readAssistantFlags).
 *
 * @param {string|undefined} rawValue
 * @param {object} opts
 * @param {string} opts.name
 * @param {string[]} opts.defaultValue
 * @returns {string[]}
 */
function parseListEnv(rawValue, { name: _name, defaultValue }) {
  if (rawValue == null || String(rawValue).trim() === '') {
    return [...defaultValue];
  }
  return String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Is a single named flag on? Used for the PER-ACTION gate: each action
 * descriptor names its own env var in its `featureFlag` field, so this helper
 * never needs to know which actions exist. That keeps lib/flags.js free of any
 * dependency on the registry (and the registry free of any hardcoded env
 * names), which is what lets a new action be added without touching this file.
 *
 * Defaults to false — an action whose flag is unset is off.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string} flagName
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {boolean}
 */
function isFlagEnabled(env, flagName, { warn = console.warn } = {}) {
  if (!flagName) return false;
  return parseBoolEnv(env[flagName], { name: flagName, defaultValue: false, warn });
}

// Documented defaults, in one place, so the .env.example and the tests can be
// checked against the same source. Every gate is closed by default; the two
// allow-lists are the only entries where the default is permissive in shape,
// and both are still gated behind `enabled` being false by default.
const ASSISTANT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Which roles may use the assistant at all. Coarse rollout control that
  // reuses the roles the app already has, rather than new infrastructure.
  allowedRoles: Object.freeze(['teacher']),
  // Tenant rollout by school code. EMPTY MEANS ALL SCHOOLS — it is a filter,
  // not a gate, and `enabled` is the gate.
  allowedSchoolCodes: Object.freeze([]),
  // Interpret calls per user per day. Bounds a single account's cost.
  dailyBudgetPerUser: 100,
});

const DAILY_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });

/**
 * Read the assistant's global flags from an environment object.
 *
 * Takes `env` as a parameter rather than reading process.env directly so it
 * stays pure and testable, matching how index.js already calls parseIntEnv.
 * Per-action flags are NOT read here — see isFlagEnabled.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedRoles: string[], allowedSchoolCodes: string[], dailyBudgetPerUser: number}}
 */
function readAssistantFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.ASSISTANT_ENABLED, {
      name: 'ASSISTANT_ENABLED',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedRoles: parseListEnv(env.ASSISTANT_ALLOWED_ROLES, {
      name: 'ASSISTANT_ALLOWED_ROLES',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.allowedRoles,
    }),
    allowedSchoolCodes: parseListEnv(env.ASSISTANT_ALLOWED_SCHOOL_CODES, {
      name: 'ASSISTANT_ALLOWED_SCHOOL_CODES',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.ASSISTANT_DAILY_BUDGET_PER_USER, {
      name: 'ASSISTANT_DAILY_BUDGET_PER_USER',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: DAILY_BUDGET_BOUNDS.min,
      max: DAILY_BUDGET_BOUNDS.max,
      warn,
    }),
  };
}

// ---- Multimodal attachments (Coach: image/PDF upload) ----------------------
//
// Mirrors the assistant flags above exactly: every gate defaults OFF/closed,
// ATTACHMENTS_ENABLED is the one reliable kill switch (same PWA-caching
// reasoning as ASSISTANT_ENABLED — G28 applies here too), and the school
// allow-list is a filter, not a gate.

const ATTACHMENT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
  // Attachment requests are the most expensive call in the product (image/PDF
  // tokens), so the default daily ceiling is deliberately lower than the
  // router's own text-only classification budget.
  dailyBudgetPerUser: 20,
  maxFileSizeMb: 8,
  maxPdfPages: 30,
  // Multi-attachment batch limits (a single message may attach several
  // files, sent to Gemini together — see attachments/describeAttachment.js).
  // maxFiles keeps the per-request Gemini call bounded in count; maxTotalSizeMb
  // is a SEPARATE guard from maxFileSizeMb x maxFiles (see the reasoning in
  // lib/fileValidation.js's validateAttachmentBatch): five files each just
  // under the per-file cap could still add up to a request too large or too
  // slow for Gemini's inline-data path. 15MB raw is comfortably under
  // Gemini's ~20MB inline-request ceiling once base64's ~33% overhead is
  // added.
  maxFiles: 5,
  maxTotalSizeMb: 15,
});

const ATTACHMENT_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });
const ATTACHMENT_FILE_SIZE_BOUNDS = Object.freeze({ min: 1, max: 20 });
const ATTACHMENT_PDF_PAGES_BOUNDS = Object.freeze({ min: 1, max: 500 });
const ATTACHMENT_MAX_FILES_BOUNDS = Object.freeze({ min: 1, max: 10 });
const ATTACHMENT_TOTAL_SIZE_BOUNDS = Object.freeze({ min: 1, max: 40 });

/**
 * Read the attachment feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{
 *   enabled: boolean,
 *   allowedSchoolCodes: string[],
 *   dailyBudgetPerUser: number,
 *   maxFileSizeMb: number,
 *   maxPdfPages: number,
 *   maxFiles: number,
 *   maxTotalSizeMb: number,
 * }}
 */
function readAttachmentFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.ATTACHMENTS_ENABLED, {
      name: 'ATTACHMENTS_ENABLED',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.ATTACHMENT_ALLOWED_SCHOOL_CODES, {
      name: 'ATTACHMENT_ALLOWED_SCHOOL_CODES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.ATTACHMENT_DAILY_BUDGET_PER_USER, {
      name: 'ATTACHMENT_DAILY_BUDGET_PER_USER',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: ATTACHMENT_BUDGET_BOUNDS.min,
      max: ATTACHMENT_BUDGET_BOUNDS.max,
      warn,
    }),
    maxFileSizeMb: parseIntEnv(env.ATTACHMENT_MAX_FILE_SIZE_MB, {
      name: 'ATTACHMENT_MAX_FILE_SIZE_MB',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxFileSizeMb,
      min: ATTACHMENT_FILE_SIZE_BOUNDS.min,
      max: ATTACHMENT_FILE_SIZE_BOUNDS.max,
      warn,
    }),
    maxPdfPages: parseIntEnv(env.ATTACHMENT_MAX_PDF_PAGES, {
      name: 'ATTACHMENT_MAX_PDF_PAGES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxPdfPages,
      min: ATTACHMENT_PDF_PAGES_BOUNDS.min,
      max: ATTACHMENT_PDF_PAGES_BOUNDS.max,
      warn,
    }),
    maxFiles: parseIntEnv(env.ATTACHMENT_MAX_FILES, {
      name: 'ATTACHMENT_MAX_FILES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxFiles,
      min: ATTACHMENT_MAX_FILES_BOUNDS.min,
      max: ATTACHMENT_MAX_FILES_BOUNDS.max,
      warn,
    }),
    maxTotalSizeMb: parseIntEnv(env.ATTACHMENT_MAX_TOTAL_SIZE_MB, {
      name: 'ATTACHMENT_MAX_TOTAL_SIZE_MB',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxTotalSizeMb,
      min: ATTACHMENT_TOTAL_SIZE_BOUNDS.min,
      max: ATTACHMENT_TOTAL_SIZE_BOUNDS.max,
      warn,
    }),
  };
}

// ---- Help & Support (bug reports + feedback) -------------------------------
//
// Same shape and same "default OFF" reasoning as the flags above — a
// deployment that sets nothing ships zero new UI or endpoints. Unlike the
// assistant/attachment flags, this feature makes no LLM call, so there is no
// daily-budget-per-user tunable here: the shared per-IP rate limiter mounted
// in index.js is what bounds abuse, the same way routes/queries.js's
// /feedback endpoint has no budget of its own either.

const HELP_SUPPORT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Tenant rollout by school code, same "empty means all schools" contract as
  // ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes above — a filter, not a gate.
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read the Help & Support feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readHelpSupportFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.HELP_SUPPORT_ENABLED, {
      name: 'HELP_SUPPORT_ENABLED',
      defaultValue: HELP_SUPPORT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.HELP_SUPPORT_ALLOWED_SCHOOL_CODES, {
      name: 'HELP_SUPPORT_ALLOWED_SCHOOL_CODES',
      defaultValue: HELP_SUPPORT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// ---- AI Learning Representation System (ADR Phase D) -----------------------
//
// Same shape and same "default OFF" reasoning as the flags above. Unlike
// the assistant/attachment flags, this feature makes at most TWO Gemini
// calls per request (classify, then render — see
// routes/learningRepresentation.js) rather than one, so the default daily
// ceiling sits between the assistant's (100, one call each) and the
// attachment feature's (20, the most expensive call shape in the product).
// No `allowedRoles`: any authenticated teacher who can reach Coach can use
// this, matching /api/coach itself and the attachment endpoint, neither of
// which restricts by role.

const LEARNING_REPRESENTATION_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
  dailyBudgetPerUser: 50,
});

const LEARNING_REPRESENTATION_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });

/**
 * Read the AI Learning Representation feature's global flags from an
 * environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[], dailyBudgetPerUser: number}}
 */
function readLearningRepresentationFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.LEARNING_REPRESENTATION_ENABLED, {
      name: 'LEARNING_REPRESENTATION_ENABLED',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES, {
      name: 'LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER, {
      name: 'LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: LEARNING_REPRESENTATION_BUDGET_BOUNDS.min,
      max: LEARNING_REPRESENTATION_BUDGET_BOUNDS.max,
      warn,
    }),
  };
}

// ---- Classroom Mode --------------------------------------------------------
//
// See docs/classroom-mode.md. Same shape and same "default OFF" reasoning as
// every flag above.
//
// This one matters more than most, because the feature is the only place in the
// app where ONE teacher action costs several model calls instead of one (a
// coaching answer, a planner call, then one generation per applicable
// artifact). CLASSROOM_MODE_ENABLED is therefore a real spend control as well
// as a kill switch: flipping it false stops that fan-out for everyone in under
// a minute, including already-loaded PWA clients that still have the client
// flag baked in. The client's VITE_CLASSROOM_MODE_ENABLED only decides whether
// the "+" button renders — it is NOT the incident control (G28's reasoning
// applies here exactly as it does to the assistant and attachment flags).
//
// No daily-budget-per-user tunable here yet: the pilot ships uncapped by owner
// decision D9, with usage measured first (P7 telemetry) so any future cap is
// set from real numbers rather than a guess. allowedSchoolCodes is what bounds
// exposure until then.

const CLASSROOM_MODE_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Tenant rollout by school code, same "empty means all schools" contract as
  // ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes — a filter, not a gate.
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read Classroom Mode's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readClassroomModeFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.CLASSROOM_MODE_ENABLED, {
      name: 'CLASSROOM_MODE_ENABLED',
      defaultValue: CLASSROOM_MODE_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.CLASSROOM_MODE_ALLOWED_SCHOOL_CODES, {
      name: 'CLASSROOM_MODE_ALLOWED_SCHOOL_CODES',
      defaultValue: CLASSROOM_MODE_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// ---- PYQ Question Paper Intelligence ---------------------------------------
//
// See docs/pyq-implementation-plan.md. Same shape and same "default OFF"
// reasoning as every flag above — a deployment that sets nothing ships no new
// teacher-facing surface. Unlike the other features here, this flag does NOT
// gate the admin ingestion/review routes (routes/adminPyq.js) at all — those
// are role-gated only (requireRole('super_admin')), never flag-gated, because
// ingestion is an always-available admin capability, not a rollout surface
// (see §12: "write access is role-gated; read access is feature-flag-gated").
// This flag exists to gate the TEACHER-FACING read/generation endpoints added
// in a later phase — defined here now (Phase 2) purely as forward-declared
// infrastructure, the same way index.js constructs an idle `pyqGemini`
// instance in this same phase before Phase 3 has any use for it.
const PYQ_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Tenant rollout by school code, same "empty means all schools" contract as
  // ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes above — a filter, not a gate.
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read the PYQ feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readPyqFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.PYQ_ENABLED, {
      name: 'PYQ_ENABLED',
      defaultValue: PYQ_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.PYQ_ALLOWED_SCHOOL_CODES, {
      name: 'PYQ_ALLOWED_SCHOOL_CODES',
      defaultValue: PYQ_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

module.exports = {
  parseBoolEnv,
  parseListEnv,
  isFlagEnabled,
  readAssistantFlags,
  ASSISTANT_FLAG_DEFAULTS,
  readAttachmentFlags,
  ATTACHMENT_FLAG_DEFAULTS,
  readHelpSupportFlags,
  HELP_SUPPORT_FLAG_DEFAULTS,
  readLearningRepresentationFlags,
  LEARNING_REPRESENTATION_FLAG_DEFAULTS,
  readClassroomModeFlags,
  CLASSROOM_MODE_FLAG_DEFAULTS,
  readPyqFlags,
  PYQ_FLAG_DEFAULTS,
};
