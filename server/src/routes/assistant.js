// HTTP surface of the AI Action Router: GET /catalog (what the app can do), POST /interpret (message -> decision)
// and POST /events (outcome of a decision the client acted on).
// /events exists because both halves of the field-edit rate are client-side facts: only the client knows a draft was
// applied and which fields were then edited. Folding them into the next /interpret would bias the metric, since a
// session that ends at the Generator (routing worked) never returns to the composer.
// A thin shell: authenticate, check rollout gates, validate the envelope, delegate (the pipeline is assistant/interpret.js).
// With the flags at their default (off), every response is the inert empty catalog or an immediate passthrough.

const crypto = require('crypto');

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readAssistantFlags } = require('../lib/flags');
const { resolveRoleListSetting, ASSISTANT_ALLOWED_ROLES_SETTING_KEY } = require('../lib/systemSettings');
const { buildCatalog, DISABLED_CATALOG } = require('../actions/registry');
const {
  MAX_UTTERANCE_LENGTH,
  MAX_EVENT_BATCH,
  ASSISTANT_EVENT_NAMES,
  PREFILL_OUTCOMES,
  PROVENANCE_SOURCES,
} = require('../assistant/contracts');
const { interpret } = require('../assistant/interpret');
// The decision log helper lives in assistant/telemetry.js so both channels (stdout and Event rows) and the privacy
// rule sit in one file. No cycle: telemetry.js is a leaf.
const { logAssistantEvent, writeAssistantEvents } = require('../assistant/telemetry');

const router = express.Router();

/**
 * Is this caller inside the current rollout? Flags are read per request, so flipping ASSISTANT_ENABLED and
 * restarting is the whole procedure and tests can drive the gates against one shared app. The school allow-list needs
 * the school code but the token carries the ID, so it costs one lookup, skipped when the list is empty.
 *
 * @returns {Promise<boolean>}
 */
async function isWithinRollout(user, flags) {
  if (!flags.enabled) return false;

  // The admin-configurable override (Admin Settings > AI Access) wins over ASSISTANT_ALLOWED_ROLES when set; otherwise
  // the env-derived `flags.allowedRoles` applies. An empty override means "no role may use the Assistant", never
  // "no restriction" (see lib/systemSettings.js).
  const { roles: allowedRoles } = await resolveRoleListSetting(ASSISTANT_ALLOWED_ROLES_SETTING_KEY, flags.allowedRoles);
  if (!allowedRoles.includes(user.role)) return false;

  if (flags.allowedSchoolCodes.length === 0) return true;

  // Fails closed. This lookup is the only I/O in the gate, and a rejection here used to reach the global handler and
  // return a 500, which /interpret must never do and /catalog treats as a normal state. Returning false makes the
  // assistant inert and never treats an unreadable database as permission granted.
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

// GET /api/assistant/catalog: the actions this caller may use. It returns the inert empty catalog for a caller outside
// the rollout rather than an error, and a client that receives it simply never routes.
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

/**
 * The request envelope. It lives here because it validates the client's contract with this endpoint (an HTTP
 * concern); the model's contract is in assistant/proposalSchema.js.
 * `.strict()` at the top level: an unknown key means the client speaks a contract version the server lacks, worth a
 * loud 400. Safe in rollout because the server ships ahead of the client, so the mismatch that occurs is a stale
 * client sending fewer fields, all optional below.
 * `memory` entries aren't strict: the client owns that structure and the server reads three fields.
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
    // Accepted and validated so a malformed one is a clean 400, but ignored for now: answering a clarifying question
    // by free text is handled on the client, and such a message is classified normally.
    pendingAsk: z.object({ actionId: z.string().max(60), slot: z.string().max(60) }).nullable().optional(),
    turn: z.number().int().min(1).optional(),
    // Read by the client's stale-response guard, not the server, and not echoed: the response has no field for it.
    sequence: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Read the teacher's saved preferences for slot resolution. Profile defaults come from the database, not from
 * anything the client sent, so a default language can't be spoofed. Fails soft: a missing profile means fewer prefilled fields.
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

// POST /api/assistant/interpret: a message in, a decision out.
// It returns non-2xx for exactly three things: authentication (401), a malformed envelope (400) and rate limiting
// (429). Everything else (assistant off, classifier timeout, safety block, unusable proposal, a bug) is a 200 with
// `passthrough: true`, and the client submits to /api/coach as usual. A 5xx reaching the client is a defect.
router.post(
  '/interpret',
  authRequired,
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const flags = readAssistantFlags(process.env);

    // Stage 1: kill switch and rollout gates, before any other work. It reuses the catalog endpoint's predicate so the
    // two agree on the rollout, and reports catalogVersion 0 to match the inert catalog, voiding a cached one.
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

    // The routing instance, never app.locals.gemini. If absent the app was misconfigured, and it degrades like everything else here.
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

    // Both are built once in index.js and injected, never module state, since the test suite shares one app per worker and
    // a leaked counter or open breaker would make failures order-dependent. If absent, the pipeline's permissive defaults
    // apply and routing runs unguarded; failing the request would turn a wiring mistake into an outage.
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

    // One structured stdout line per decision, no database writes. `Event` rows are reserved for the low-volume
    // prefill-delivered/outcome pair; one row per interpret call would be a sustained write stream on single-writer SQLite.
    logAssistantEvent(telemetry.internalError ? 'error' : 'info', 'interpret_completed', {
      requestId,
      ...telemetry,
    });

    return res.json(response);
  })
);

/**
 * One telemetry event as the client sends it. Every field is metadata, which is the privacy control: `name`,
 * `outcome` and `from` are closed enums, `actionId` and `field` are bounded ids checked against the registry downstream,
 * and the rest are integers. There's nowhere to put an utterance, slot value, generated content or model output, even
 * from a buggy or compromised client.
 * `.strict()`, since an unknown key is the shape a leak would take. The bounds on `fieldCount`/`corrections` are
 * generous against the Generator's eight slots and only bound the database work per request.
 */
const telemetryEventSchema = z
  .object({
    name: z.enum([...ASSISTANT_EVENT_NAMES]),
    // Re-checked against the registry in telemetry.js, which drops an event naming an unknown action. A length bound
    // isn't a privacy control: 60 characters fits a topic, and this field was a smuggling channel until a test showed it.
    actionId: z.string().min(1).max(60),
    // The join key between the Event row and its stdout decision line. Constrained to the UUID shape the interpret
    // endpoint mints, since a free string was a second smuggling channel. The client echoes a server-minted id or omits it.
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
            // A slot name, re-checked against the registry in telemetry.js; unrecognised names are dropped, since a length bound alone wouldn't stop a topic.
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

// POST /api/assistant/events: what the teacher did with a prefill. The assistant's only write, and only to `Event`
// (telemetry about its own behaviour, not something a teacher owns). It answers 204 with no body: the client is
// fire-and-forget and never retries or shows anything. As with /interpret, a failed write is still a 204.
router.post(
  '/events',
  authRequired,
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();

    // Same rollout predicate as the other endpoints. With the flags off it writes nothing, so "zero rows" holds for telemetry too.
    const flags = readAssistantFlags(process.env);
    if (!(await isWithinRollout(req.user, flags))) {
      return res.status(204).end();
    }

    // Charged per request, not per event: the IP limiter was the only bound, and one looping client could sustain writes
    // against the single-writer table. The request is what costs a round trip, and batch size is already bounded by
    // MAX_EVENT_BATCH. Over budget drops the batch and answers 204, so this can lose a measurement and never cost a teacher anything.
    const eventBudget = req.app.locals.assistantEventBudget;
    if (eventBudget && !eventBudget.consume(req.user.id)) {
      logAssistantEvent('warn', 'telemetry_budget_exhausted', { requestId });
      return res.status(204).end();
    }

    const parsed = eventsRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      // The one non-2xx beyond auth and rate limiting. A malformed batch is a client defect; the client drops it rather than retrying.
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

    // Channel 1 records the volume of channel 2, so the two-rows-per-session guarantee is observable in production; a climbing batch size shows here first.
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
