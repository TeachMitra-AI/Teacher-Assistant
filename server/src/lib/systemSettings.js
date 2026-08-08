// Runtime-mutable overrides for existing env-var configuration (lib/flags.js),
// admin-configurable through /api/admin/feature-flags (Admin Settings) without
// a redeploy. Covers two kinds of setting:
//   - feature_flag (type: 'boolean')   — e.g. Learning Representation
//   - access_control (type: 'role_list') — e.g. which roles may use the Assistant
//
// The env var stays the safe default/fallback for BOTH kinds: a SystemSetting
// row is entirely optional, and its absence — the default, unconfigured
// state — falls back to the env value the caller supplies, so a deployment
// that never opens Admin Settings behaves exactly as it did before this
// feature existed. A DB error, or a row whose value doesn't parse into the
// setting's type, also falls back to that same default rather than throwing
// or granting anything wider — matching the "a database we cannot read is
// never treated as an unsafe state" discipline
// routes/learningRepresentation.js's isWithinRollout already uses for its own
// school-allow-list gate.
//
// Deliberately no in-memory caching: every read is a fresh query, so every
// server instance behind a load balancer sees the same value on its very
// next request — a process-local cache would let instances disagree about
// which teachers see a feature, or which roles may use the Assistant. This
// mirrors an existing precedent in this codebase: isWithinRollout already
// does one Prisma read per request for its own gate, so a per-request read
// here is not a new class of cost.
//
// See docs/admin-feature-flags-architecture.md for the full design.

const { prisma } = require('./db');
const { readLearningRepresentationFlags, readAssistantFlags } = require('./flags');
const { APP_ROLES } = require('./roles');

/**
 * Every admin-toggleable setting, keyed by the id used in the API path
 * (/api/admin/feature-flags/:id) and by the client. Adding a future setting
 * is additive: one entry here, one row in the client's Admin Settings list —
 * no new route. This IS the allowlist: nothing outside this object is
 * reachable through the admin settings API, so no other env var or secret is
 * ever exposed through it.
 */
const ADMIN_SETTINGS_REGISTRY = {
  'learning-representation': {
    kind: 'feature_flag',
    type: 'boolean',
    settingKey: 'learning_representation_enabled',
    label: 'Learning Representation',
    description: 'Shows the "View as visual" option on Coach answers.',
    envDefault: () => readLearningRepresentationFlags(process.env).enabled,
  },
  'assistant-allowed-roles': {
    kind: 'access_control',
    type: 'role_list',
    settingKey: 'assistant_allowed_roles',
    label: 'Assistant Access',
    description: 'Which roles may use the AI Assistant / Action Router.',
    envDefault: () => readAssistantFlags(process.env).allowedRoles,
    // An EMPTY list is a valid, deliberate override meaning "no role may use
    // the Assistant" — NOT "no restriction". That's the opposite convention
    // from ASSISTANT_ALLOWED_SCHOOL_CODES (empty there means "all schools"),
    // and deliberately so: this is the primary access gate, so empty must
    // read as "nobody", never as "everybody" — see resolveRoleListSetting.
    validate: (roles) => Array.isArray(roles) && roles.every((r) => APP_ROLES.includes(r)),
  },
};

// ---- Generic (type-aware) read/write ---------------------------------------

function serializeValue(type, value) {
  if (type === 'boolean') return String(Boolean(value));
  if (type === 'role_list') return JSON.stringify(value);
  throw new Error(`Unsupported setting type: ${type}`);
}

/**
 * Returns the deserialized value, or undefined if `raw` doesn't parse into
 * `type`. Boolean never returns undefined (matches the original
 * implementation bit-for-bit: any stored string other than the literal
 * "true" reads as false, exactly as `row.value === 'true'` always has) —
 * only role_list can be genuinely unparseable (non-JSON, or JSON that isn't
 * an array), which is the one case that needs a distinct "corrupt, fall back
 * to the env default" signal.
 */
function deserializeValue(type, raw) {
  if (type === 'boolean') return raw === 'true';
  if (type === 'role_list') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  throw new Error(`Unsupported setting type: ${type}`);
}

/**
 * The effective value of one setting: the SystemSetting override if a row
 * exists AND parses cleanly for `type`, else `fallback` (the caller's
 * already-computed env default).
 *
 * @param {string} key
 * @param {{type: 'boolean'|'role_list', fallback: unknown}} opts
 * @returns {Promise<{value: unknown, source: 'override'|'env-default', updatedAt: Date|null}>}
 */
async function resolveSetting(key, { type, fallback }) {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) return { value: fallback, source: 'env-default', updatedAt: null };
    const value = deserializeValue(type, row.value);
    if (value === undefined) {
      console.warn(`[systemSettings] "${key}" has an unparseable value; falling back to default.`);
      return { value: fallback, source: 'env-default', updatedAt: null };
    }
    return { value, source: 'override', updatedAt: row.updatedAt };
  } catch (err) {
    console.warn(`[systemSettings] failed to read "${key}"; falling back to default.`, err);
    return { value: fallback, source: 'env-default', updatedAt: null };
  }
}

/**
 * Sets (creates or replaces) an override. `updatedById` is a soft reference
 * to the acting admin (see the SystemSetting model comment) — the durable
 * audit trail is the Event row the caller writes alongside this.
 */
async function setSetting(key, value, updatedById, { type }) {
  const serialized = serializeValue(type, value);
  return prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: serialized, updatedById },
    update: { value: serialized, updatedById },
  });
}

// ---- Boolean settings (Learning Representation) — unchanged behavior ------

/**
 * @param {string} key
 * @param {boolean} fallback
 * @returns {Promise<{enabled: boolean, source: 'override'|'env-default', updatedAt: Date|null}>}
 */
async function resolveBoolSetting(key, fallback) {
  const { value, source, updatedAt } = await resolveSetting(key, { type: 'boolean', fallback });
  return { enabled: value, source, updatedAt };
}

/**
 * @param {string} key
 * @param {boolean} enabled
 * @param {string} updatedById
 */
async function setBoolSetting(key, enabled, updatedById) {
  return setSetting(key, Boolean(enabled), updatedById, { type: 'boolean' });
}

// ---- Role-list settings (Assistant Access) ---------------------------------

/**
 * @param {string} key
 * @param {string[]} fallbackRoles
 * @returns {Promise<{roles: string[], source: 'override'|'env-default', updatedAt: Date|null}>}
 */
async function resolveRoleListSetting(key, fallbackRoles) {
  const { value, source, updatedAt } = await resolveSetting(key, { type: 'role_list', fallback: fallbackRoles });
  return { roles: value, source, updatedAt };
}

/**
 * @param {string} key
 * @param {string[]} roles
 * @param {string} updatedById
 */
async function setRoleListSetting(key, roles, updatedById) {
  // Deduped, not re-validated here — the caller (the admin route) is the
  // system boundary and already checked every entry against APP_ROLES.
  return setSetting(key, [...new Set(roles)], updatedById, { type: 'role_list' });
}

// ---- Registry-driven helpers, for the admin route --------------------------

/** Full descriptor for one registered setting, by its API id. */
async function describeSetting(id) {
  const entry = ADMIN_SETTINGS_REGISTRY[id];
  if (!entry) return null;
  const base = { id, label: entry.label, description: entry.description, kind: entry.kind, type: entry.type };
  if (entry.type === 'boolean') {
    const resolved = await resolveBoolSetting(entry.settingKey, entry.envDefault());
    return { ...base, enabled: resolved.enabled, source: resolved.source, updatedAt: resolved.updatedAt };
  }
  if (entry.type === 'role_list') {
    const resolved = await resolveRoleListSetting(entry.settingKey, entry.envDefault());
    return { ...base, roles: resolved.roles, source: resolved.source, updatedAt: resolved.updatedAt };
  }
  throw new Error(`Unsupported setting type: ${entry.type}`);
}

/** Every registered setting's current effective state, for GET /api/admin/feature-flags. */
async function listAdminSettings() {
  return Promise.all(Object.keys(ADMIN_SETTINGS_REGISTRY).map(describeSetting));
}

/**
 * Applies a new value to one registered setting (boolean `enabled` or
 * role_list `roles`, matching the entry's `type`). Returns the updated
 * descriptor, or null if `id` isn't a known setting (caller responds 404).
 */
async function setAdminSetting(id, value, updatedById) {
  const entry = ADMIN_SETTINGS_REGISTRY[id];
  if (!entry) return null;
  if (entry.type === 'boolean') {
    await setBoolSetting(entry.settingKey, value, updatedById);
  } else if (entry.type === 'role_list') {
    await setRoleListSetting(entry.settingKey, value, updatedById);
  } else {
    throw new Error(`Unsupported setting type: ${entry.type}`);
  }
  return describeSetting(id);
}

/**
 * The subset of effective flags exposed to every signed-in user as part of
 * session bootstrap (login/google/refresh-restore responses) — just the
 * booleans a client-side UI gate needs, never source/audit metadata. Assistant
 * role access has no client-side gate to feed (the Assistant endpoints already
 * degrade to an inert response for a caller outside the rollout — see
 * routes/assistant.js), so it is deliberately NOT included here.
 *
 * @returns {Promise<{learningRepresentationEnabled: boolean}>}
 */
async function getEffectiveFeatureFlags() {
  const entry = ADMIN_SETTINGS_REGISTRY['learning-representation'];
  const resolved = await resolveBoolSetting(entry.settingKey, entry.envDefault());
  return { learningRepresentationEnabled: resolved.enabled };
}

module.exports = {
  ADMIN_SETTINGS_REGISTRY,
  resolveBoolSetting,
  setBoolSetting,
  resolveRoleListSetting,
  setRoleListSetting,
  listAdminSettings,
  setAdminSetting,
  getEffectiveFeatureFlags,
  // Exported so the routes that actually ENFORCE these settings (not just the
  // admin UI that toggles them) can look up their override without retyping
  // the DB key — see routes/learningRepresentation.js and routes/assistant.js.
  LEARNING_REPRESENTATION_SETTING_KEY: ADMIN_SETTINGS_REGISTRY['learning-representation'].settingKey,
  ASSISTANT_ALLOWED_ROLES_SETTING_KEY: ADMIN_SETTINGS_REGISTRY['assistant-allowed-roles'].settingKey,
};
