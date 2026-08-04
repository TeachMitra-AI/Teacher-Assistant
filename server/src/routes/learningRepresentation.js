// AI Learning Representation System — HTTP surface (ADR Phase D).
//
// One endpoint: POST /api/coach/learning-representation. Given a teacher's
// question and the answer already produced for it (by the existing
// /api/coach flow — this endpoint is stateless and does not look it up),
// runs the full pipeline built in Phases A-E: classify -> resolve a
// representation (confidence gate + renderer-availability gate) -> render
// structured content if one applies, checking the Phase E request-level
// cache first.
//
// THE ERROR CONTRACT IS DELIBERATELY THE SAME SHAPE AS
// /api/assistant/interpret (routes/assistant.js), not the same shape as
// /api/coach/attachment. Non-2xx is reserved for exactly three things:
// authentication (401), a malformed envelope (400), and rate limiting
// (429). Every other outcome — the feature being off, budget exhausted, the
// classifier abstaining, low confidence, a renderer being unavailable, a
// render failure — collapses to the SAME 200 shape:
// `{ requestId, representation: 'verbal_explanation', data: null }`. This
// was a deliberate choice over attachments.js's 503-when-disabled pattern:
// this pipeline already treats "nothing to show" as a first-class, frequent,
// safe outcome at every layer (ADR Product Principle 1) — making "disabled"
// the one case that behaves differently would be the one inconsistency in
// an otherwise uniform contract, and would cost the client a special case
// for no benefit.
//
// This file is a thin shell, matching routes/assistant.js's own stated
// discipline: authenticate, check the rollout gates, validate the envelope,
// delegate to the Phase A-C modules, shape the response, log. No business
// rule beyond HTTP concerns lives here.

const crypto = require('crypto');

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readLearningRepresentationFlags } = require('../lib/flags');
const { classify } = require('../learningRepresentation/classifier');
const { resolveRenderableRepresentation } = require('../learningRepresentation/rendering/resolve');
const { renderWithCache } = require('../learningRepresentation/rendering/cache');
const { VERBAL_EXPLANATION } = require('../learningRepresentation/representations');
const { logLearningRepresentationEvent, levelForReason } = require('../learningRepresentation/telemetry');

const router = express.Router();

/** Mirrors MAX_QUERY_LENGTH in index.js — this IS the same question /api/coach already accepted. */
const MAX_PROMPT_LENGTH = 500;
/**
 * Generous ceiling for the answer text the client sends back. Comfortably
 * covers any real /api/coach response; the global 16kb JSON body limit
 * (index.js) is already a tighter practical ceiling than this once the rest
 * of the envelope and JSON escaping overhead are counted — this exists as
 * the application-level bound, not the primary control, matching how
 * MAX_EVENT_METADATA_LENGTH is described in assistant/contracts.js.
 */
const MAX_ANSWER_LENGTH = 6000;

const requestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
  })
  .strict();

/**
 * Is this caller inside the current rollout? Mirrors routes/assistant.js's
 * isWithinRollout, minus the role check — no allowedRoles gate exists for
 * this feature (see lib/flags.js's comment: any authenticated teacher who
 * can reach Coach can use this).
 *
 * @returns {Promise<boolean>}
 */
async function isWithinRollout(user, flags) {
  if (!flags.enabled) return false;
  if (flags.allowedSchoolCodes.length === 0) return true;

  // Fails closed, same reasoning as routes/assistant.js: a database we
  // cannot read is never treated as permission granted.
  let school;
  try {
    school = await prisma.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
  } catch {
    return false;
  }
  return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
}

router.post(
  '/coach/learning-representation',
  authRequired,
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const flags = readLearningRepresentationFlags(process.env);

    /** Every non-success path funnels through here — one place the 200-with-verbal_explanation contract is built. */
    function abstain(reason) {
      logLearningRepresentationEvent(levelForReason(reason), 'learning_representation_completed', {
        requestId,
        representation: VERBAL_EXPLANATION,
        reason,
      });
      return res.json({ requestId, representation: VERBAL_EXPLANATION, data: null });
    }

    // Stage 1 — kill switch and rollout gate, before any other work.
    if (!(await isWithinRollout(req.user, flags))) {
      return abstain('disabled');
    }

    // The only 400 this endpoint produces.
    const parsed = requestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'A non-empty "prompt" and "answer" are required.',
        requestId,
      });
    }
    const { prompt, answer } = parsed.data;

    // classify() uses the ROUTING instance (small, cheap, tight budget — same
    // instance routes/assistant.js uses, for the same reason: this is a
    // small structured classification, not a full answer). render() reuses
    // the MAIN coaching instance instead: its 8192-token budget comfortably
    // covers the largest structured payload any RENDER_SPECS entry allows,
    // where geminiFast's 512-token budget (tuned for a 2-field
    // classification) would risk truncating a 12-step diagram. Neither
    // instance is constructed here — both already exist in index.js and are
    // reused via app.locals, per this project's established pattern.
    const geminiFast = req.app.locals.geminiFast;
    const gemini = req.app.locals.gemini;
    if (
      !geminiFast ||
      typeof geminiFast.generateContent !== 'function' ||
      !gemini ||
      typeof gemini.generateContent !== 'function'
    ) {
      return abstain('misconfigured');
    }

    // Charged once per REQUEST, before it's known whether render() will hit
    // the cache — deliberately not recalculated per actual Gemini call.
    // Matches this codebase's existing convention exactly: assistant/
    // budget.js's own header notes a turn that ends before the classifier
    // "still spends a unit... over-enforcement degrades to a coaching
    // answer, which this architecture treats as always safe." A cache hit
    // is the same shape of over-enforcement (a unit spent for less actual
    // Gemini usage than the budget assumes), accepted for the same reason:
    // simple and predictable beats precisely metered.
    const budget = req.app.locals.learningRepresentationBudget;
    if (budget && !budget.consume(req.user.id)) {
      return abstain('budget_exhausted');
    }

    const classified = await classify({ gemini: geminiFast, prompt, requestId });
    const resolved = resolveRenderableRepresentation(classified);

    if (resolved.representation === VERBAL_EXPLANATION) {
      // Covers three distinct causes with one shape: the classifier failed
      // outright, confidence was too low, or the intent genuinely was
      // no_visualization (source 'mapped', no `reason` — logged as its own
      // value so it is not confused with an abstain-on-uncertainty case).
      return abstain(resolved.reason || 'no_visualization');
    }

    // Phase E: cache-aside around render() (rendering/cache.js). A missing
    // cache local (app assembled without one) degrades to "always miss",
    // never to an error — same posture as the budget/breaker locals above.
    const renderCache = req.app.locals.learningRepresentationRenderCache;
    const rendered = await renderWithCache({
      gemini,
      representation: resolved.representation,
      prompt,
      answer,
      requestId,
      cache: renderCache,
    });
    if (!rendered.ok) {
      return abstain(rendered.reason);
    }

    logLearningRepresentationEvent('info', 'learning_representation_completed', {
      requestId,
      representation: rendered.representation,
      intent: classified.ok ? classified.intent : null,
      confidence: classified.ok ? classified.confidence : null,
      // Lets Phase F compute real hit rate from logs — see cache.js's own
      // note on reading this alongside deploy frequency, not in isolation.
      cached: rendered.cached,
    });
    return res.json({ requestId, representation: rendered.representation, data: rendered.data });
  })
);

module.exports = router;
