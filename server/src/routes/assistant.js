// AI Action Router — HTTP surface.
//
// Two endpoints: GET /catalog (M2) tells a caller what the application can do,
// POST /interpret (M5) turns a message into a decision about it.
//
// This file is a thin shell on purpose: authenticate, check the rollout gates,
// validate the envelope, delegate, shape the response. No business rules live
// here — the pipeline is assistant/interpret.js and every rule it applies lives
// in a module below that.
//
// Everything is additive. No existing route, middleware or contract is touched,
// and with the flags at their defaults (all OFF) every response below is the
// same inert empty catalog or an immediate passthrough.

const crypto = require('crypto');

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readAssistantFlags } = require('../lib/flags');
const { buildCatalog, DISABLED_CATALOG } = require('../actions/registry');
const { MAX_UTTERANCE_LENGTH } = require('../assistant/contracts');
const { interpret } = require('../assistant/interpret');

const router = express.Router();

/**
 * Metadata-only structured log, mirroring the `logAiEvent` helper in index.js.
 *
 * Deliberately a local copy of three lines rather than an import: index.js
 * requires this router, so importing back from it would create a cycle, and in
 * CommonJS a cycle yields a partially-initialised module (guardrail 12a). If a
 * third caller ever needs this, it moves to a leaf in lib/ that all three
 * import — it does not get exported from an entrypoint or a route.
 *
 * NEVER pass utterance text or resolved slot values through here (G11). The
 * decision log carries ids, counts, and enum values only.
 */
function logAssistantEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[assistant] ${event}`, meta);
}

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

  // FAILS CLOSED, added at M5. This lookup is the only I/O in the gate, and an
  // unhandled rejection here reached the global error handler and returned a
  // 500 — from /interpret, which may never return a 5xx (G22), and from
  // /catalog, whose whole design is that "not enabled for you" is a normal
  // state rather than an error.
  //
  // Found by deliberately breaking the pipeline's total catch and noticing that
  // the integration suite did not care, which meant something upstream of it was
  // unprotected. Returning false is the safe direction in both senses: the
  // assistant goes inert (the designed degraded state) rather than erroring, and
  // a database we cannot read is never treated as permission granted.
  let school;
  try {
    school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { code: true },
    });
  } catch {
    return false;
  }
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

// ---- POST /api/assistant/interpret -----------------------------------------

/**
 * The request envelope (pipeline stage 4).
 *
 * Lives here rather than in assistant/ because it validates the CLIENT's
 * contract with this endpoint, which is an HTTP concern — the same way
 * routes/auth.js and routes/resources.js declare their own request schemas
 * locally. The model's contract is a different thing entirely and lives in
 * assistant/proposalSchema.js.
 *
 * `.strict()` at the top level: an unknown key means the client is speaking a
 * version of this contract the server does not have, and that is worth a loud
 * 400 during development rather than a silently ignored field. Safe in rollout
 * because the PWA sequencing rule ships the server ahead of the client, so the
 * mismatch that actually occurs in the wild is a STALE client sending FEWER
 * fields — every one of which is optional below.
 *
 * `memory` entries are NOT strict, deliberately: the client owns that structure
 * and the server only reads three fields from it, so an extra key there is the
 * client's business and gets stripped rather than rejected.
 */
const memorySlotSchema = z.object({
  value: z.union([z.string(), z.number()]),
  raw: z.string().max(MAX_UTTERANCE_LENGTH).optional(),
  source: z.string().max(40).optional(),
  turn: z.number().int().min(0).optional(),
});

const interpretRequestSchema = z
  .object({
    utterance: z.string().trim().min(1).max(MAX_UTTERANCE_LENGTH),
    catalogVersion: z.number().int().min(0).optional(),
    memory: z.record(z.string().max(60), memorySlotSchema).optional(),
    // Accepted and validated so a malformed one is a clean 400, then
    // deliberately IGNORED in M5 (decision D5). Answering a clarifying question
    // by free text is conversational shortcutting, which belongs to M6 with the
    // rest of the turn handling; until then such a message is simply classified
    // normally, which produces a correct if slightly less efficient result.
    pendingAsk: z.object({ actionId: z.string().max(60), slot: z.string().max(60) }).nullable().optional(),
    turn: z.number().int().min(1).optional(),
    // Read by the CLIENT's stale-response guard (CHANGE-9), not by the server,
    // and deliberately not echoed: the frozen InterpretResponse has no field for
    // it, and the client can match a response to its own in-flight request
    // without help.
    sequence: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Read the teacher's saved preferences for slot resolution.
 *
 * Server-authoritative on purpose: profile defaults must come from the database
 * rather than from anything the client sent, or a teacher's "default language"
 * would be spoofable. Fails soft to no preferences — a missing profile means
 * fewer prefilled fields, never a failed request.
 */
function makeProfileReader(userId) {
  return async () => {
    try {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
      if (!row || !row.preferences) return {};
      const parsed = JSON.parse(row.preferences);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
}

// POST /api/assistant/interpret — a message in, a decision out.
//
// THE ERROR CONTRACT IS THE POINT OF THIS HANDLER (G22). It returns non-2xx for
// exactly three things: authentication (401, from the middleware), a malformed
// envelope (400), and rate limiting (429, from the mounted limiter). Everything
// else — the assistant being switched off, a classifier timeout, a safety block,
// an unusable proposal, a bug in our own code — is a 200 carrying
// `passthrough: true`, and the client submits to /api/coach exactly as it does
// today. There is no 5xx contract here; a 5xx reaching the client is a defect.
router.post(
  '/interpret',
  authRequired,
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const flags = readAssistantFlags(process.env);

    // Stage 1 — kill switch and rollout gates, before any other work. Reuses
    // the same predicate the catalog endpoint uses, so the two can never
    // disagree about who is inside the rollout. Reports catalogVersion 0 to
    // match the inert catalog, which tells a client holding a cached catalog
    // that its assumptions are void.
    if (!(await isWithinRollout(req.user, flags))) {
      return res.json({
        catalogVersion: DISABLED_CATALOG.catalogVersion,
        passthrough: true,
        actions: [],
        reason: 'disabled',
        requestId,
      });
    }

    // Stage 4 — envelope validation. The only 400 this endpoint produces.
    const parsed = interpretRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'A non-empty "utterance" string is required.',
        requestId,
      });
    }

    // The ROUTING instance, never app.locals.gemini (G20). Absent only if the
    // app was constructed without it, which is a misconfiguration rather than a
    // teacher-visible failure — so it degrades like everything else here.
    const geminiFast = req.app.locals.geminiFast;
    if (!geminiFast || typeof geminiFast.generateContent !== 'function') {
      logAssistantEvent('error', 'interpret_misconfigured', { requestId });
      return res.json({
        catalogVersion: DISABLED_CATALOG.catalogVersion,
        passthrough: true,
        actions: [],
        reason: 'disabled',
        requestId,
      });
    }

    const { utterance, memory, turn } = parsed.data;

    // Stages 5-12.
    const { response, telemetry } = await interpret(
      { utterance, role: req.user.role, memory, turn, requestId },
      { gemini: geminiFast, env: process.env, readProfile: makeProfileReader(req.user.id) }
    );

    // CHANGE-6: one structured stdout line per decision, zero database writes.
    // `Event` rows are reserved for the low-volume prefill-delivered/outcome
    // pair in M8 — one row per interpret call would turn a rare-incident table
    // into a sustained write stream on single-writer SQLite, which surfaces
    // later as generalized slowness that nobody attributes to this feature.
    logAssistantEvent(telemetry.internalError ? 'error' : 'info', 'interpret_completed', {
      requestId,
      ...telemetry,
    });

    return res.json(response);
  })
);

module.exports = router;
