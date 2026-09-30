// The interpret pipeline (stages 5-12; the HTTP shell handles kill switch, auth, rate limit and envelope validation).
// Orchestration only: each rule lives elsewhere (safety/inputGuard.js, actions/registry.js, actions/vocab/,
// assistant/resolver.js, assistant/policy.js). Everything external is injected, so the pipeline runs in a unit test.
// Invariant: no input or bug may produce anything but a well-formed response. Stages 5-12 run inside a
// catch-all, so a defect costs a routing opportunity and the teacher still gets a coaching answer.

const { detectEmergency, normalizeQuery } = require('../safety/inputGuard');
const { CATALOG_VERSION, listForRole } = require('../actions/registry');
const { parseProposal } = require('./proposalSchema');
const { recoverSlots } = require('./slotRecovery');
const { resolveSlots } = require('./resolver');
const { decide } = require('./policy');
const { classify: defaultClassify } = require('./classifier');
const { createDisabledBreaker } = require('./breaker');

/** Default budget gate; allows everything. routes/assistant.js injects the real counter (assistant/budget.js). */
const allowWithinBudget = async () => true;

/** No profile preferences available. The route injects the real reader. */
const noProfile = async () => ({});

/**
 * Build a passthrough response. Every failure path ends here; `reason` is diagnostic only and
 * the teacher always just gets a normal coaching answer.
 */
function passthrough(reason, requestId, telemetry = {}) {
  return {
    response: {
      catalogVersion: CATALOG_VERSION,
      passthrough: true,
      actions: [],
      reason,
      requestId,
    },
    telemetry: { decision: 'passthrough', reason, ...telemetry },
  };
}

/** Project the recovery outcome onto the decision log: slot names only, and only non-empty lists. */
function recoveryTelemetry(recovery) {
  const fields = {};
  const recoveredNames = Object.keys(recovery.recovered);
  if (recoveredNames.length > 0) fields.recoveredSlots = recoveredNames;
  if (recovery.skipped.length > 0) fields.recoverySkipped = [...recovery.skipped];
  if (recovery.rejected.length > 0) fields.recoveryRejected = [...recovery.rejected];
  if (recovery.ambiguous.length > 0) fields.recoveryAmbiguous = [...recovery.ambiguous];
  return fields;
}

/**
 * Turn an utterance into a decision.
 *
 * @param {object} input
 * @param {string} input.utterance raw, already length-checked by the envelope
 * @param {string} input.role the caller's role, for catalog filtering
 * @param {object} [input.memory] client-held session memory
 * @param {number} [input.turn] current turn number, for memory expiry
 * @param {string} input.requestId
 * @param {object} deps
 * @param {object} deps.gemini the geminiFast instance
 * @param {Record<string, string|undefined>} deps.env
 * @param {() => Promise<object>} [deps.readProfile] the teacher's saved preferences
 * @param {() => Promise<boolean>} [deps.checkBudget] per-user daily budget
 * @param {object} [deps.breaker] router breaker
 * @param {Function} [deps.classify] injectable for tests
 * @returns {Promise<{response: object, telemetry: object}>}
 */
async function interpret(
  { utterance, role, memory = {}, turn = 1, requestId },
  {
    gemini,
    env,
    readProfile = noProfile,
    checkBudget = allowWithinBudget,
    breaker = createDisabledBreaker(),
    classify = defaultClassify,
  } = {}
) {
  const startedAt = Date.now();

  try {
    // Stage 5: normalize. A message that normalizes to nothing was only invisible characters.
    const normalized = normalizeQuery(utterance);
    if (normalized.length === 0) {
      return passthrough('not_an_action', requestId);
    }

    // Stage 6: emergency short-circuit. Must stay above the classifier so an emergency reaches the
    // emergency coach prompt with no added latency and is never routed into a form.
    if (detectEmergency(normalized).isEmergency) {
      return passthrough('emergency_detected', requestId);
    }

    // --- Stage 7. Per-user daily budget -------------------------------------
    if (!(await checkBudget())) {
      return passthrough('budget_exhausted', requestId);
    }

    // Stage 8: role-filtered catalog. An empty list means every action is off for this caller, so skip the model call.
    const descriptors = listForRole(role, env);
    if (descriptors.length === 0) {
      return passthrough('disabled', requestId);
    }

    // Stage 8b: breaker. While open, Gemini is rate-limiting us and the Coach needs the quota.
    // Reported as `classifier_error`; `breakerOpen` on the telemetry line makes it diagnosable.
    if (breaker.isOpen()) {
      return passthrough('classifier_error', requestId, { breakerOpen: true });
    }

    // Stage 9: classify, the only AI call in the pipeline.
    const classified = await classify({ gemini, utterance: normalized, descriptors, requestId });
    const calls = (classified.metrics && classified.metrics.callsMade) || 0;

    // Feed the outcome back to the breaker. Only genuine upstream rate limiting counts, not timeouts or safety blocks.
    if (classified.metrics && classified.metrics.rateLimited) {
      breaker.recordRateLimited();
    } else if (classified.ok) {
      breaker.recordSuccess();
    }

    if (!classified.ok) {
      return passthrough(classified.reason, requestId, { calls });
    }

    // Stage 10a: validate the proposal and re-authorize the intent.
    const validated = parseProposal(classified.raw, descriptors);
    if (!validated.ok) {
      return passthrough(validated.reason, requestId, { calls });
    }

    const { intent, confidence, descriptor, slots, dropped, margin } = validated.proposal;

    // The model has no action for this, a common and correct outcome. Ask policy.js which passthrough
    // reason that earns so the rule stays in one place.
    if (!descriptor) {
      const nonAction = decide({ descriptor: null, intent, confidence });
      return passthrough(nonAction.reason, requestId, { calls, confidence });
    }

    // Stage 10a': deterministic recovery of `grade` and `subject` the model didn't report. It can't reach
    // the model. It runs here, after authorization, so our parser's output stays outside the untrusted-model
    // boundary; it reads `normalized`, the same text the classifier saw, and never overwrites a reported slot.
    const recovery = recoverSlots({
      descriptor,
      utterance: normalized,
      alreadyFilled: Object.keys(slots),
    });

    // Stage 10b: canonicalize, merge, provenance, per-field validation. The model's influence ends at the raw slot strings.
    const profile = await readProfile();
    const resolved = resolveSlots({
      descriptor,
      slots,
      recovered: recovery.recovered,
      memory,
      profile,
      turn,
    });

    // Stage 11: decide. The action's effect caps the decision, then only prefill/ask/passthrough can be emitted.
    const outcome = decide({
      descriptor,
      intent,
      confidence,
      margin,
      missing: resolved.missing,
      contradictions: resolved.contradictions,
    });

    if (outcome.decision === 'passthrough') {
      return passthrough(outcome.reason, requestId, {
        calls,
        confidence,
        actionId: descriptor.id,
      });
    }

    // Stage 12: shape the response. Provenance, confidence and requestId are siblings of `params`;
    // the generation schema is `.strict()`, so metadata inside params would 400.
    const action = {
      actionId: descriptor.id,
      version: descriptor.version,
      effect: descriptor.effect,
      decision: outcome.decision,
      confidence,
      params: resolved.params,
      provenance: resolved.provenance,
      missing: resolved.missing,
      lowConfidenceFields: resolved.lowConfidenceFields,
    };
    if (outcome.ask) action.ask = outcome.ask;

    const response = {
      catalogVersion: CATALOG_VERSION,
      passthrough: false,
      actions: [action],
      requestId,
    };

    // Not offered on an `ask`: a half-formed reading shouldn't outlive the question meant to settle it.
    if (outcome.decision !== 'ask' && Object.keys(resolved.memoryUpdates).length > 0) {
      response.memoryUpdates = resolved.memoryUpdates;
    }

    return {
      response,
      telemetry: {
        decision: outcome.decision,
        actionId: descriptor.id,
        confidence,
        margin,
        calls,
        missingCount: resolved.missing.length,
        lowConfidenceCount: resolved.lowConfidenceFields.length,
        contradictionCount: resolved.contradictions.length,
        droppedSlots: dropped,
        // Recovery attribution: slot names only, never values. `recoveryRejected` shows the false-positive
        // gate working, and a sudden drop means it was loosened.
        ...recoveryTelemetry(recovery),
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    // A defect in our own code. Reported as `classifier_error` since the passthrough reasons are a frozen
    // vocabulary; the log carries the detail.
    return passthrough('classifier_error', requestId, {
      internalError: error.message,
      latencyMs: Date.now() - startedAt,
    });
  }
}

module.exports = { interpret };
