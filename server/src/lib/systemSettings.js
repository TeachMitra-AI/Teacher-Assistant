// Runtime-mutable overrides for env-var config (lib/flags.js), editable through /api/admin/feature-flags without a
// redeploy (docs/admin-feature-flags-architecture.md). Two kinds: feature_flag (boolean) and access_control
// (role_list, e.g. which roles may use the Assistant).
// The env var stays the default: a missing SystemSetting row falls back to the env value the caller supplies, and
// so does a DB error or an unparseable row, rather than throwing or granting anything wider (same stance as
// isWithinRollout in routes/learningRepresentation.js).
// No in-memory caching: every read queries, so all instances behind a load balancer agree on who sees a feature.

const { prisma } = require('./db');
const { readLearningRepresentationFlags, readAssistantFlags } = require('./flags');
const { APP_ROLES } = require('./roles');

/**
 * Every admin-toggleable setting, keyed by the id in the API path (/api/admin/feature-flags/:id) and used by
 * the client. A new setting is one entry here plus one client row. This is the allowlist: nothing outside it
 * is reachable through the admin settings API, so no other env var or secret is exposed.
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
    // An empty list is a deliberate override meaning "no role may use the Assistant", not "no restriction". That's the
    // opposite of ASSISTANT_ALLOWED_SCHOOL_CODES (empty = all schools): this is the primary access gate, so empty
    // must read as nobody (see resolveRoleListSetting).
    validate: (roles) => Array.isArray(roles) && roles.every((r) => APP_ROLES.includes(r)),
  },
};

function serializeValue(type, value) {
  if (type === 'boolean') return String(Boolean(value));
  if (type === 'role_list') return JSON.stringify(value);
  throw new Error(`Unsupported setting type: ${type}`);
}

/**
 * Returns the deserialized value, or undefined if `raw` doesn't parse into `type`. Boolean never returns
 * undefined: any stored string other than "true" reads as false. Only role_list can be unparseable (non-JSON or
 * not an array), which signals "corrupt, use the env default".
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
 * The effective value of one setting: the SystemSetting override if a row exists and parses for `type`, else
 * `fallback` (the caller's env default).
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
 * Sets (creates or replaces) an override. `updatedById` is a soft reference to the acting admin; the audit
 * trail is the Event row the caller writes alongside.
 */
async function setSetting(key, value, updatedById, { type }) {
  const serialized = serializeValue(type, value);
  return prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: serialized, updatedById },
    update: { value: serialized, updatedById },
  });
}

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
 * Applies a new value to one registered setting (boolean `enabled` or role_list `roles`, per its `type`).
 * Returns the updated descriptor, or null if `id` isn't a known setting (caller responds 404).
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
 * The effective flags exposed to every signed-in user at session bootstrap: only the booleans a client UI gate
 * needs, never source or audit metadata. Assistant role access is left out since its endpoints already degrade
 * to an inert response for callers outside the rollout.
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
  // Exported so the routes that enforce these settings can look up their override without retyping the DB key.
  LEARNING_REPRESENTATION_SETTING_KEY: ADMIN_SETTINGS_REGISTRY['learning-representation'].settingKey,
  ASSISTANT_ALLOWED_ROLES_SETTING_KEY: ADMIN_SETTINGS_REGISTRY['assistant-allowed-roles'].settingKey,
};
