// AI Action Router — HTTP surface.
//
// Milestone M2 provides the catalog only. POST /interpret arrives in M5; until
// then the router advertises what the application can do and nothing acts on it.
//
// This file is a thin shell on purpose: authenticate, check the rollout gates,
// delegate to the registry, shape the response. No business rules live here.
//
// Everything is additive. No existing route, middleware or contract is touched,
// and with the flags at their defaults (all OFF) every response below is the
// same inert empty catalog.

const express = require('express');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readAssistantFlags } = require('../lib/flags');
const { buildCatalog, DISABLED_CATALOG } = require('../actions/registry');

const router = express.Router();

/**
 * Is this caller inside the current rollout?
 *
 * Flags are read per request rather than cached at module load so that flipping
 * ASSISTANT_ENABLED and restarting is genuinely the whole procedure, and so
 * tests can drive the gates against the single shared app instance without
 * rebuilding it. The cost is a few string comparisons.
 *
 * The school allow-list needs the school CODE (what an operator knows: "DPS001")
 * while the access token carries the school ID, so it costs one indexed lookup —
 * which is why it is skipped entirely when the list is empty, i.e. in the default
 * configuration and during the phases where rollout is controlled by role alone.
 *
 * @returns {Promise<boolean>}
 */
async function isWithinRollout(user, flags) {
  if (!flags.enabled) return false;
  if (!flags.allowedRoles.includes(user.role)) return false;

  if (flags.allowedSchoolCodes.length === 0) return true;

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { code: true },
  });
  return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
}

// GET /api/assistant/catalog — the actions this caller may currently use.
//
// Never 404s or errors for a caller outside the rollout: it returns the inert
// empty catalog instead. "The assistant is not on for you" is a normal state,
// not a failure, and a client that receives it simply never routes.
router.get(
  '/catalog',
  authRequired,
  asyncHandler(async (req, res) => {
    const flags = readAssistantFlags(process.env);

    if (!(await isWithinRollout(req.user, flags))) {
      return res.json(DISABLED_CATALOG);
    }

    return res.json(buildCatalog(req.user.role, process.env));
  })
);

module.exports = router;
