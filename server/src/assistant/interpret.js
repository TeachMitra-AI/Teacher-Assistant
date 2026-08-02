// The interpret pipeline (Milestone M5).
//
// ORCHESTRATION ONLY. Every rule this file appears to apply actually lives
// somewhere else: the emergency check in safety/inputGuard.js, the visible
// action set in actions/registry.js, canonicalization in actions/vocab/, slot
// precedence in assistant/resolver.js, and the decision in assistant/policy.js.
// If a rule starts being written here, it is in the wrong file — this one is
// meant to stay boring enough that its correctness is obvious by reading it.
//
// NO DATABASE, NO EXPRESS, NO CLOCK BEYOND A DURATION. Everything external
// arrives as an injected dependency, which is why the whole 12-stage pipeline —
// including all nine passthrough reasons — is exercisable from a unit test with
// no server, no fixtures and no key.
//
// THE ONE INVARIANT THIS FILE EXISTS TO UPHOLD: no input, and no bug, may
// produce anything other than a well-formed response. Stages 5 through 12 run
// inside a total catch, so a defect in any of them costs a routing opportunity
// and nothing else. The teacher gets their coaching answer (G22, invariant I11).

const { detectEmergency, normalizeQuery } = require('../safety/inputGuard');
const { CATALOG_VERSION, listForRole } = require('../actions/registry');
const { parseProposal } = require('./proposalSchema');
const { recoverSlots } = require('./slotRecovery');
const { resolveSlots } = require('./resolver');
const { decide } = require('./policy');
const { classify: defaultClassify } = require('./classifier');
const { createDisabledBreaker } = require('./breaker');

/**
 * The per-user daily budget gate (pipeline stage 7).
 *
 * The permissive DEFAULT, kept module-private. M5 shipped this as the whole
 * implementation — a seam that counted nothing (decision D1) — and M9 filled it
 * in without editing this file's logic: routes/assistant.js now injects a real
 * counter (assistant/budget.js) as `checkBudget`, exactly as the seam was
 * designed for. The default survives because every unit test that does not care
 * about budgets should not have to construct one.
 *
 * The behaviour it produces is asserted through `interpret`.
 */
const allowWithinBudget = async () => true;

/** No profile preferences available. The route injects the real reader. */
const noProfile = async () => ({});

/**
 * Build a passthrough response. Every failure path in this file ends here, and
 * they are deliberately indistinguishable to the teacher: `reason` is diagnostic
 * only and is never displayed. All nine produce one experience — a normal
 * coaching answer.
 *
 * Module-private: this shapes THIS pipeline's response envelope and has no
 * meaning outside it. The envelope it produces is asserted through `interpret`
 * and, end to end, through the route.
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

/**
 * Project the recovery stage's outcome onto the decision log.
 *
 * Only non-empty lists appear, so a turn where nothing was recoverable adds
 * nothing to the line. Names only — see the call site for why.
 *
 * @param {{recovered: object, skipped: string[], rejected: string[], ambiguous: string[]}} recovery
 */
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
 * Stages 1-4 (kill switch, auth, rate limit, envelope validation) belong to the
 * HTTP shell and have already run by the time this is called; this function owns
 * stages 5-12.
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
 * @param {() => Promise<boolean>} [deps.checkBudget] stage 7
 * @param {object} [deps.breaker] stage 8b — the CHANGE-8 router breaker
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
    // --- Stage 5. Normalize (existing inputGuard, consumed not modified) -----
    // NFKC + invisible-character stripping. A message that normalizes to nothing
    // was only zero-width characters; there is nothing to classify.
    const normalized = normalizeQuery(utterance);
    if (normalized.length === 0) {
      return passthrough('not_an_action', requestId);
    }

    // --- Stage 6. EMERGENCY SHORT-CIRCUIT -----------------------------------
    // NON-NEGOTIABLE, and it must stay above stage 9. A teacher describing an
    // active emergency reaches the existing emergency coach prompt with zero
    // added latency and zero chance of being routed into a worksheet form. The
    // classifier is not called, not awaited, and not warmed up (G10).
    if (detectEmergency(normalized).isEmergency) {
      return passthrough('emergency_detected', requestId);
    }

    // --- Stage 7. Per-user daily budget -------------------------------------
    if (!(await checkBudget())) {
      return passthrough('budget_exhausted', requestId);
    }

    // --- Stage 8. Build the role-filtered catalog ---------------------------
    // Applies status, per-action feature flag and requiredRoles. An empty list
    // means every action is flagged off for this caller, so there is nothing to
    // classify against and no reason to spend a model call finding that out.
    const descriptors = listForRole(role, env);
    if (descriptors.length === 0) {
      return passthrough('disabled', requestId);
    }

    // --- Stage 8b. THE ROUTER YIELDS TO THE COACH (CHANGE-8) ----------------
    // Open means the upstream is rate-limiting us, and the Coach and the router
    // draw on one quota. Spending a call here to fail is a call the Coach could
    // have used to answer a teacher's question, so the optional feature steps
    // back and the core one keeps working (invariant I12).
    //
    // Reported as `classifier_error` (approval A3) because that frozen reason
    // already means "upstream failure" and the teacher can never tell the nine
    // reasons apart anyway; `breakerOpen` on the telemetry line is what makes it
    // diagnosable. This is the only gate in the pipeline whose state is shared
    // across users, which is why it is injected rather than global.
    if (breaker.isOpen()) {
      return passthrough('classifier_error', requestId, { breakerOpen: true });
    }

    // --- Stage 9. Classify — the ONLY AI call in the pipeline ---------------
    const classified = await classify({ gemini, utterance: normalized, descriptors, requestId });
    const calls = (classified.metrics && classified.metrics.callsMade) || 0;

    // Feed the outcome back. `rateLimited` is set by gemini.js on its own
    // per-request tracker and travels out on the error's metrics, so this reads
    // the shared service's signal without gemini.js being touched (G21) and
    // without classifier.js gaining a decision. ONLY genuine upstream rate
    // limiting counts: a timeout or a safety block is an ordinary routing
    // failure the pipeline already degrades correctly, and treating those as
    // quota pressure would open the breaker for unrelated reasons.
    if (classified.metrics && classified.metrics.rateLimited) {
      breaker.recordRateLimited();
    } else if (classified.ok) {
      breaker.recordSuccess();
    }

    if (!classified.ok) {
      return passthrough(classified.reason, requestId, { calls });
    }

    // --- Stage 10a. Validate the proposal, and re-authorize the intent (G4) --
    const validated = parseProposal(classified.raw, descriptors);
    if (!validated.ok) {
      return passthrough(validated.reason, requestId, { calls });
    }

    const { intent, confidence, descriptor, slots, dropped, margin } = validated.proposal;

    // The model reported it has no action for this — the most common outcome in
    // a coaching app, and a correct one.
    //
    // The branch is structural, not a rule: `resolveSlots` cannot be handed a
    // null descriptor, so the pipeline has to stop here. But WHICH passthrough
    // reason a non-action intent earns is a decision, and decisions belong to
    // policy.js. Asking it rather than hardcoding 'not_an_action' keeps that
    // rule in exactly one place — otherwise a Phase 2 change to how policy
    // treats `coach_question` would be silently bypassed by this line.
    if (!descriptor) {
      const nonAction = decide({ descriptor: null, intent, confidence });
      return passthrough(nonAction.reason, requestId, { calls, confidence });
    }

    // --- Stage 10a′. Deterministic vocabulary recovery ----------------------
    // Reads `grade` and `subject` out of the utterance when the model did not
    // report them. Pure, deterministic, and incapable of reaching the model —
    // no prompt, no schema, no parameter — so the routing decision above is
    // untouched by anything this returns.
    //
    // Placed HERE and not one stage earlier: it needs the AUTHORIZED descriptor
    // (G4), and folding it into sanitizeSlots would put our own parser's output
    // inside the untrusted-model boundary, where `dropped` would then describe
    // this pipeline as though the model had produced it.
    //
    // `normalized` rather than the raw utterance, so the scanner reads exactly
    // the text the classifier was given. `slots` keys are what the model
    // reported, which is how "never overwrite Gemini" is enforced structurally.
    const recovery = recoverSlots({
      descriptor,
      utterance: normalized,
      alreadyFilled: Object.keys(slots),
    });

    // --- Stage 10b. Canonicalize, merge, provenance, per-field validation ----
    // Everything below this line is deterministic M4 code. The model's influence
    // ends at the raw strings in `slots`.
    const profile = await readProfile();
    const resolved = resolveSlots({
      descriptor,
      slots,
      recovered: recovery.recovered,
      memory,
      profile,
      turn,
    });

    // --- Stage 11. Decide ---------------------------------------------------
    // Rule 0 (the registry-declared effect caps the decision at any confidence)
    // followed by the Phase 1 clamp. No input can emit `execute`.
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

    // --- Stage 12. Shape the response ---------------------------------------
    // GUARDRAIL G3: provenance, confidence and requestId are SIBLINGS of
    // `params`. The generation schema is `.strict()`, so metadata folded into
    // params would make every downstream generation request fail with a 400.
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

    // Only offered when there is something to remember, and never on an `ask`:
    // a turn that ended in a question has not settled anything yet, so writing
    // its half-formed reading into memory would let a guess outlive the question
    // that was meant to resolve it.
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
        // Recovery attribution. SLOT NAMES ONLY, never the recovered values
        // (G11) — the names are what makes a field-edit-rate movement
        // diagnosable, and the values are the teacher's own words.
        //
        // Emitted only when non-empty so the ordinary line does not grow four
        // empty arrays. `recoveryRejected` is the one to watch: it is the only
        // visible evidence of the false-positive gate doing its job, and a
        // sudden fall in it means the gate has been loosened.
        ...recoveryTelemetry(recovery),
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    // A defect in our own code, not the model's. Reported as `classifier_error`
    // because the nine passthrough reasons are a frozen wire vocabulary and none
    // of them means "we have a bug" — adding a tenth would be a contract change
    // to describe something the teacher must never be able to tell apart anyway.
    // The distinguishing detail goes to the log, where it is actionable.
    return passthrough('classifier_error', requestId, {
      internalError: error.message,
      latencyMs: Date.now() - startedAt,
    });
  }
}

module.exports = { interpret };
