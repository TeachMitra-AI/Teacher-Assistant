// Admin Settings — temporary, runtime overrides of existing env-var
// configuration (lib/flags.js), toggleable without a redeploy. Two kinds of
// setting, both driven by the same allowlisted registry
// (lib/systemSettings.js's ADMIN_SETTINGS_REGISTRY):
//   - Feature Management (type: 'boolean')   — e.g. Learning Representation
//   - AI Access (type: 'role_list')          — e.g. Assistant allowed roles
//
// SCOPE: like adminSupport.js, every route here is super_admin-only — these
// are global, app-wide switches, not a school's own data, the same reasoning
// adminSupport.js already established for the ticket inbox (kept as its own
// file for the same reason: a different access model than routes/admin.js's
// role-scoped rest, easier to see correctly on its own).
//
// Each setting is a temporary OVERRIDE, never a replacement: the underlying
// env var remains the safe default/fallback (see lib/systemSettings.js) — a
// deployment that never opens this screen is unaffected. Only settings
// present in ADMIN_SETTINGS_REGISTRY are reachable through this API — no
// other env var or secret is ever exposed here.
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
// An EMPTY roles array is accepted deliberately — it's a valid override
// meaning "no role may use the Assistant" (see ADMIN_SETTINGS_REGISTRY's
// comment on this setting). Every entry must be a real, known role; an
// unrecognized name is a 400, never silently dropped or ignored.
const roleListBodySchema = z.object({ roles: z.array(z.enum(APP_ROLES)) }).strict();

function bodySchemaFor(type) {
  if (type === 'boolean') return booleanBodySchema;
  if (type === 'role_list') return roleListBodySchema;
  return null;
}

// PATCH /api/admin/feature-flags/:id — update one setting's override. Writes
// an Event audit row, same convention routes/admin.js's decidePendingUser
// already uses for admin-mutating actions (who did what, durably).
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
  // Belt-and-braces re-check against the registry's own validator (role
  // membership is already enforced by the zod z.enum above; `validate`
  // exists so a future entry with a richer rule doesn't need route-level
  // changes here).
  if (entry.validate && !entry.validate(value)) {
    return res.status(400).json({ error: 'Invalid value for this setting.' });
  }

  const updated = await setAdminSetting(req.params.id, value, req.user.id);
  await prisma.event.create({
    data: {
      userId: req.user.id,
      type: 'feature_flag_updated',
      // The actual SystemSetting key (not the route id), so this audit
      // record matches what's queryable in the SystemSetting table itself.
      // `enabled` for a boolean setting (unchanged shape, matches the
      // original Learning Representation audit exactly); `roles` for a
      // role_list setting.
      metadata: JSON.stringify(
        entry.type === 'boolean' ? { key: entry.settingKey, enabled: value } : { key: entry.settingKey, roles: value }
      ),
    },
  });

  res.json(updated);
}));

module.exports = router;
