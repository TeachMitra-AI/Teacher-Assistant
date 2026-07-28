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

module.exports = {
  parseBoolEnv,
  parseListEnv,
  isFlagEnabled,
  readAssistantFlags,
  ASSISTANT_FLAG_DEFAULTS,
};
