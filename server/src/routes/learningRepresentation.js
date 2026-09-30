// AI Learning Representation System: POST /api/coach/learning-representation. Given a teacher's question and the
// answer already produced for it (stateless; it doesn't look it up), it runs classify -> resolve a representation
// (confidence gate and renderer-availability gate) -> render structured content if one applies, checking the
// request-level cache first.
// The error contract matches /api/assistant/interpret, not /api/coach/attachment: non-2xx only for authentication
// (401), a malformed envelope (400) and rate limiting (429). Everything else (feature off, budget exhausted,
// classifier abstaining, low confidence, no renderer, render failure) is the same 200
// `{ requestId, representation: 'verbal_explanation', data: null }`. The pipeline already treats "nothing to show"
// as a normal outcome, so a 503 for "disabled" would be the one inconsistency and cost the client a special case.
// A thin shell like routes/assistant.js: authenticate, check rollout gates, validate, delegate, shape the response, log.

const crypto = require('crypto');

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readLearningRepresentationFlags } = require('../lib/flags');
const { resolveBoolSetting, LEARNING_REPRESENTATION_SETTING_KEY } = require('../lib/systemSettings');
const { classify } = require('../learningRepresentation/classifier');
const { resolveRenderableRepresentation } = require('../learningRepresentation/rendering/resolve');
const { renderWithCache } = require('../learningRepresentation/rendering/cache');
const { VERBAL_EXPLANATION } = require('../learningRepresentation/representations');
const { logLearningRepresentationEvent, levelForReason } = require('../learningRepresentation/telemetry');

const router = express.Router();

/** Mirrors MAX_QUERY_LENGTH in index.js — this IS the same question /api/coach already accepted. */
const MAX_PROMPT_LENGTH = 500;
/**
 * Ceiling for the answer text the client sends back. Raised from 6000 after a normal multi-strategy Coach answer
 * exceeded it and was rejected in manual QA. The global 16kb JSON body limit (index.js) is tighter in practice;
 * this is the application-level bound, like MAX_EVENT_METADATA_LENGTH in assistant/contracts.js.
 */
const MAX_ANSWER_LENGTH = 12000;

const requestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
  })
  .strict();

/**
 * A human-authored 400 message instead of raw zod text, like the other routes. The original handler surfaced
 * zod's "Too big: expected string to have <=6000 characters" to the teacher.
 *
 * @param {import('zod').SafeParseReturnType<unknown, unknown>} parsed a failed safeParse result
 * @returns {string}
 */
function friendlyValidationMessage(parsed) {
  const field = parsed.error.issues[0]?.path?.[0];
  if (field === 'answer') {
    return 'This answer is too long to generate a visual for right now. Try asking a shorter or more specific question.';
  }
  if (field === 'prompt') {
    return 'A question is required.';
  }
  return 'A non-empty "prompt" and "answer" are required.';
}

/**
 * Is this caller inside the current rollout? Mirrors routes/assistant.js's isWithinRollout minus the role check;
 * any authenticated teacher who can reach Coach can use this (see lib/flags.js).
 *
 * @returns {Promise<boolean>}
 */
async function isWithinRollout(user, flags) {
  // The admin-configurable override (Admin Settings > Feature Management) wins over the env var when set; otherwise
  // `flags.enabled` is the fallback (see lib/systemSettings.js).
  const { enabled } = await resolveBoolSetting(LEARNING_REPRESENTATION_SETTING_KEY, flags.enabled);
  if (!enabled) return false;
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
      return res.status(400).json({ error: friendlyValidationMessage(parsed), requestId });
    }
    const { prompt, answer } = parsed.data;

    // classify() uses the routing instance (small, cheap, tight budget), like routes/assistant.js. render() uses the main
    // coaching instance: its 8192-token budget covers the largest RENDER_SPECS payload, where geminiFast's 512 tokens
    // (tuned for a 2-field classification) could truncate a 12-step diagram. Both come from app.locals, built in index.js.
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

    // Charged once per request, before it's known whether render() hits the cache. As in assistant/budget.js, slight
    // over-enforcement degrades to a coaching answer, which is always safe, and a cache hit is the same kind of
    // over-enforcement. Simple and predictable beats precisely metered.
    const budget = req.app.locals.learningRepresentationBudget;
    if (budget && !budget.consume(req.user.id)) {
      return abstain('budget_exhausted');
    }

    const classified = await classify({ gemini: geminiFast, prompt, requestId });
    const resolved = resolveRenderableRepresentation(classified);

    if (resolved.representation === VERBAL_EXPLANATION) {
      // One shape for three causes: the classifier failed, confidence was too low, or the intent was no_visualization
      // (source 'mapped', no `reason`, logged as its own value so it isn't confused with abstaining on uncertainty).
      return abstain(resolved.reason || 'no_visualization');
    }

    // Cache-aside around render() (rendering/cache.js). A missing cache local degrades to "always miss", never an error,
    // like the budget and breaker locals.
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
      // Lets cache hit rate be computed from logs; read it alongside deploy frequency (see cache.js).
      cached: rendered.cached,
    });
    return res.json({ requestId, representation: rendered.representation, data: rendered.data });
  })
);

module.exports = router;
