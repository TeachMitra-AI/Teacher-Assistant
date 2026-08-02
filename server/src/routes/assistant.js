// AI Action Router — HTTP surface.
//
// Three endpoints: GET /catalog (M2) tells a caller what the application can do,
// POST /interpret (M5) turns a message into a decision about it, and
// POST /events (M8) receives the outcome of a decision the client acted on.
//
// The third one is a deliberate amendment to the original "exactly two
// endpoints" design, approved before M8 began. The reason it is necessary: BOTH
// halves of the field-edit rate are client-side facts. The server knows it
// DECIDED prefill; only the client knows the draft was actually applied to the
// form and which fields the teacher then edited. Folding those onto the next
// /interpret call instead would have biased the metric badly — a session that
// ends at the Generator (i.e. one where routing WORKED) never returns to the
// composer, so successes would systematically under-report.
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
const {
  MAX_UTTERANCE_LENGTH,
  MAX_EVENT_BATCH,
  ASSISTANT_EVENT_NAMES,
  PREFILL_OUTCOMES,
  PROVENANCE_SOURCES,
} = require('../assistant/contracts');
const { interpret } = require('../assistant/interpret');
// M8: the decision log helper moved from here into assistant/telemetry.js, so
// that both CHANGE-6 channels — the stdout line and the Event rows — sit in one
// reviewable file with the G11 privacy rule stated once. No cycle: this route
// already requires assistant/interpret.js, and telemetry.js is a leaf.
const { logAssistantEvent, writeAssistantEvents } = require('../assistant/telemetry');

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

    // M9. Both are constructed once in index.js and injected here, never held as
    // module state (approval A4) — the test suite shares one app per worker, and
    // a counter or an open breaker leaking between test files would make
    // failures depend on execution order.
    //
    // Absent locals mean an app assembled without them, which is a
    // misconfiguration rather than a teacher-visible failure: the pipeline's own
    // permissive defaults apply and routing simply runs unguarded, exactly as it
    // did before M9. Failing the request instead would turn a wiring mistake
    // into an outage.
    const budget = req.app.locals.assistantBudget;
    const breaker = req.app.locals.assistantBreaker;

    // Stages 5-12.
    const { response, telemetry } = await interpret(
      { utterance, role: req.user.role, memory, turn, requestId },
      {
        gemini: geminiFast,
        env: process.env,
        readProfile: makeProfileReader(req.user.id),
        ...(budget ? { checkBudget: async () => budget.consume(req.user.id) } : {}),
        ...(breaker ? { breaker } : {}),
      }
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

// ---- POST /api/assistant/events (M8) ----------------------------------------

/**
 * One telemetry event, as the client sends it.
 *
 * EVERY FIELD IS METADATA, AND THAT IS THE PRIVACY CONTROL (G11). There is no
 * free-text field in this schema — `name`, `outcome` and `from` are closed
 * enums, `actionId` and `field` are bounded identifiers checked against the
 * registry downstream, and everything else is an integer. A client cannot post
 * an utterance, a slot value, generated content or model output through this
 * endpoint because the shape has nowhere to put one. That is a stronger claim
 * than "we remember not to send it", and it survives a compromised or simply
 * buggy client.
 *
 * `.strict()` for the same reason interpretRequestSchema is strict: an unknown
 * key means the client is speaking a contract version this server does not have,
 * and — more to the point here — an unknown key is exactly the shape a leak
 * would take. Rejecting is the safe direction when the payload is telemetry the
 * teacher did not ask to send.
 *
 * The bounds on `fieldCount` / `corrections` are generous relative to the eight
 * slots the Generator actually has. They exist to bound the work one request can
 * ask of the database, not to mirror the form.
 */
const telemetryEventSchema = z
  .object({
    name: z.enum([...ASSISTANT_EVENT_NAMES]),
    // Re-checked against the registry in telemetry.js, which DROPS an event
    // naming an action this server does not have. A length bound alone is not a
    // privacy control here: sixty characters is plenty of room for a topic, and
    // this field was a smuggling channel until a test posted teacher text
    // through it and watched it land in a row.
    actionId: z.string().min(1).max(60),
    // The join key between the Event row and its stdout decision line.
    //
    // CONSTRAINED TO THE UUID SHAPE the interpret endpoint actually mints, for
    // the same reason as above — as a free string it was a second smuggling
    // channel. The client either echoes a server-minted id or omits the field;
    // it has no way to produce anything else, so strictness costs nothing real.
    requestId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      .optional(),
    fieldCount: z.number().int().min(0).max(50).optional(),
    lowConfidenceCount: z.number().int().min(0).max(50).optional(),
    outcome: z.enum([...PREFILL_OUTCOMES]).optional(),
    corrections: z
      .array(
        z
          .object({
            // A slot NAME. Re-checked against the registry in telemetry.js, so
            // a name this server does not recognise is dropped rather than
            // stored — the length bound alone would not stop a topic here.
            field: z.string().min(1).max(60),
            from: z.enum([...PROVENANCE_SOURCES]),
          })
          .strict()
      )
      .max(50)
      .optional(),
  })
  .strict();

const eventsRequestSchema = z
  .object({ events: z.array(telemetryEventSchema).min(1).max(MAX_EVENT_BATCH) })
  .strict();

// POST /api/assistant/events — what the teacher did with a prefill.
//
// This is the ONLY write the assistant performs, and it writes to `Event` alone
// (guardrail G8: no AI output may trigger a write to anything a teacher owns —
// telemetry about the assistant's own behaviour is not that).
//
// It answers with 204 and nothing else. There is no body worth reading: the
// client is fire-and-forget by design, must never retry, and must never surface
// anything from here to the teacher. Applying /interpret's error contract (G22)
// to this endpoint as well, a failed write is still a 204 — a telemetry failure
// that produced a visible error would be strictly worse than the missing row.
router.post(
  '/events',
  authRequired,
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();

    // Same rollout predicate as the other two endpoints, so the three can never
    // disagree about who is inside the rollout. With the flags at their defaults
    // this endpoint writes nothing at all, which is what makes the flags-off
    // proof ("zero rows") hold for telemetry as well as for routing.
    const flags = readAssistantFlags(process.env);
    if (!(await isWithinRollout(req.user, flags))) {
      return res.status(204).end();
    }

    // M9, from the security review. Until now the only bound on this endpoint
    // was the shared IP limiter, and a batch may carry many events — so one
    // looping client could sustain writes against the single-writer table
    // CHANGE-6 exists to keep quiet. Charged PER REQUEST rather than per event,
    // because the request is what costs a round trip and the batch size is
    // already bounded by MAX_EVENT_BATCH.
    //
    // Over budget drops the batch and answers 204, exactly as a failed write
    // does: telemetry is fire-and-forget by contract, so this can lose a
    // measurement and can never cost a teacher anything.
    const eventBudget = req.app.locals.assistantEventBudget;
    if (eventBudget && !eventBudget.consume(req.user.id)) {
      logAssistantEvent('warn', 'telemetry_budget_exhausted', { requestId });
      return res.status(204).end();
    }

    const parsed = eventsRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      // The one non-2xx this endpoint produces beyond auth and rate limiting.
      // A malformed batch is a client defect worth surfacing in development,
      // and the client treats it as "drop the batch" rather than retrying.
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'A non-empty "events" array is required.',
        requestId,
      });
    }

    const { written, failed } = await writeAssistantEvents(parsed.data.events, {
      userId: req.user.id,
      schoolId: req.user.schoolId,
      requestId,
    });

    // Channel 1 records the volume of channel 2, which is how the two-rows-per-
    // session guarantee stays observable in production rather than only in a
    // test: a batch size that starts climbing is visible here first.
    logAssistantEvent(failed > 0 ? 'warn' : 'info', 'telemetry_batch_received', {
      requestId,
      received: parsed.data.events.length,
      written,
      failed,
    });

    return res.status(204).end();
  })
);

module.exports = router;
