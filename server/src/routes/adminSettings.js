// Admin Settings: runtime overrides of env-var config (lib/flags.js), toggleable without a redeploy. Two kinds,
// both from the allowlisted ADMIN_SETTINGS_REGISTRY (lib/systemSettings.js): Feature Management (boolean, e.g.
// Learning Representation) and AI Access (role_list, e.g. Assistant allowed roles).
// Every route is super_admin-only: these are global switches, not a school's data, so it's its own file like
// adminSupport.js. An override never replaces the env var, which stays the default; only registry settings are
// reachable, so no other env var or secret is exposed.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { listAdminSettings, setAdminSetting, ADMIN_SETTINGS_REGISTRY } = require('../lib/systemSettings');
const { APP_ROLES } = require('../lib/roles');

const router = express.Router();

// GET /api/admin/feature-flags — current effective state of every
// admin-toggleable setting (both kinds).
router.get('/', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const flags = await listAdminSettings();
  res.json({ flags });
}));

const booleanBodySchema = z.object({ enabled: z.boolean() }).strict();
// An empty roles array is accepted on purpose: it means "no role may use the Assistant" (see ADMIN_SETTINGS_REGISTRY).
// Every entry must be a known role; an unknown name is a 400, never silently dropped.
const roleListBodySchema = z.object({ roles: z.array(z.enum(APP_ROLES)) }).strict();

function bodySchemaFor(type) {
  if (type === 'boolean') return booleanBodySchema;
  if (type === 'role_list') return roleListBodySchema;
  return null;
}

// PATCH /api/admin/feature-flags/:id: update one setting's override. Writes an Event audit row, as admin.js's decidePendingUser does.
router.patch('/:id', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const entry = ADMIN_SETTINGS_REGISTRY[req.params.id];
  if (!entry) {
    return res.status(404).json({ error: 'Unknown setting.' });
  }

  const schema = bodySchemaFor(entry.type);
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: entry.type === 'boolean' ? 'A boolean "enabled" is required.' : 'A "roles" array of valid roles is required.',
    });
  }

  const value = entry.type === 'boolean' ? parsed.data.enabled : parsed.data.roles;
  // Re-check against the registry's validator (role membership is already enforced by z.enum), so a richer rule needs no route change.
  if (entry.validate && !entry.validate(value)) {
    return res.status(400).json({ error: 'Invalid value for this setting.' });
  }

  const updated = await setAdminSetting(req.params.id, value, req.user.id);
  await prisma.event.create({
    data: {
      userId: req.user.id,
      type: 'feature_flag_updated',
      // The real SystemSetting key (not the route id), so the audit record matches the table. `enabled` for a boolean
      // setting, `roles` for a role_list.
      metadata: JSON.stringify(
        entry.type === 'boolean' ? { key: entry.settingKey, enabled: value } : { key: entry.settingKey, roles: value }
      ),
    },
  });

  res.json(updated);
}));

module.exports = router;
