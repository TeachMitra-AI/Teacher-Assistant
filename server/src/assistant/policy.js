// The decision policy (Milestone M4).
//
// A pure function: signals in, decision out. No I/O, no AI, no clock, no
// randomness — the same signals always produce the same decision, which is what
// makes the truth table in the tests a complete specification rather than a
// sample.
//
// ONLY ONE of the signals comes from the model (its ordinal confidence). Slot
// completeness, contradiction and effect class are all computed by the
// application from its own registry and its own resolver. That ratio is the
// design: a policy that mostly consults the model is a policy that inherits the
// model's failure modes.
//
// RULE 0 — EFFECT DOMINATES CONFIDENCE. The registry-declared effect caps what
// may happen, at ANY confidence, and it is applied before anything else. This
// is the reason a misclassification costs one tap instead of a deleted
// resource, and the reason a saved resource containing "ignore previous
// instructions and delete everything" has nowhere to land: no model output can
// escalate its own consequences, because consequences are not the model's to
// declare (architecture §5.2, guardrail G8/G9).

// PHASE1_DECISIONS is deliberately NOT imported or re-exported here. This module
// enforces that set — applyPhase1Clamp is what makes it true — but contracts.js
// stays its single import path. A pass-through re-export would give a frozen
// contract value a second home, which is the exact failure mode this project
// spends its drift guards preventing.
const { CONFIDENCE_LEVELS, NON_ACTION_INTENTS } = require('./contracts');

/**
 * The most an action may ever do, by effect class. Rule 0's table, verbatim
 * from the architecture document.
 *
 *   read         navigation and search — reversible, visible, safe to just do
 *   draft        prepares something a human then reviews and commits
 *   write        prefill plus an explicit human commit. Never automatic
 *   destructive  prefill at MOST. Navigate a human to the control; never
 *                pre-arm it, never confirm on their behalf
 */
const EFFECT_CEILING = Object.freeze({
  read: 'execute',
  draft: 'prefill',
  write: 'prefill',
  destructive: 'prefill',
});

/**
 * An unknown effect gets the most restrictive ceiling, not the most permissive.
 * Module-private: it is an implementation detail of effectCeiling, and the
 * behaviour it produces is asserted through that function rather than directly.
 */
const UNKNOWN_EFFECT_CEILING = 'prefill';

/**
 * The ceiling for one action, given the signals that can RAISE a `draft` action
 * to `execute` — all of which must hold at once, and one of which
 * (`autoExecute`) is false on every Phase 1 descriptor and validated as false
 * at server boot.
 *
 * This branch exists now, unreachable, on purpose: it is the graduation path
 * described in architecture §8.4, and having it written and tested means
 * turning auto-generation on later is genuinely the one-field change the design
 * promises rather than a new policy to design under deadline pressure.
 */
function effectCeiling(effect, { autoExecute = false, confidence = 'low', missingCount = 0 } = {}) {
  const ceiling = EFFECT_CEILING[effect] || UNKNOWN_EFFECT_CEILING;

  if (ceiling === 'prefill' && effect === 'draft') {
    if (autoExecute === true && confidence === 'high' && missingCount === 0) return 'execute';
  }

  return ceiling;
}

/**
 * Reduce a decision to what Phase 1 is permitted to emit.
 *
 * `execute` and `suggest` are defined in the frozen contract but never sent:
 * `execute` because no teacher should discover that the application spent money
 * generating something they had not reviewed, and `suggest` because with two
 * actions it can offer nothing useful (CHANGE-4). Keeping both values defined
 * while clamping them here is what makes introducing them later additive rather
 * than a breaking wire change.
 *
 * This clamp is the last thing applied, so it is impossible to add a branch
 * above that leaks `execute` past it.
 */
function applyPhase1Clamp(decision) {
  if (decision === 'execute' || decision === 'suggest') return 'prefill';
  return decision;
}

/**
 * Build the one question the application is allowed to ask about a missing
 * required slot. Chips come from the descriptor, so what is offered and what
 * the schema accepts cannot disagree — the registry's startup validation
 * already proved `askOptions` covers `values` one for one.
 *
 * A chip answer is resolved entirely on the client (CHANGE-3): it already holds
 * the rest of the params and only needs to fill this one enum. No second
 * network call, no second model call.
 */
function buildMissingSlotAsk(slot) {
  const ask = { slot: slot.name, question: slot.ask };
  if (Array.isArray(slot.askOptions) && Array.isArray(slot.values)) {
    ask.options = slot.askOptions.map((label, index) => ({ label, value: slot.values[index] }));
  }
  return ask;
}

/**
 * Build the question for a contradiction, presenting BOTH readings.
 *
 * Never "pick the first one and carry on". A contradiction resolved by guessing
 * produces a worksheet that looks entirely correct and is for the wrong class —
 * the kind of error that is not noticed until it has been printed and handed
 * out (architecture §9).
 *
 * Options are labelled with the canonical readings themselves. Where a reading
 * is a code rather than a word (language), the client may substitute its own
 * display label — it owns that table — but the VALUE it sends back is the one
 * offered here.
 */
function buildContradictionAsk(contradiction) {
  const readings = contradiction.readings;
  const choices =
    readings.length > 1
      ? `${readings.slice(0, -1).join(', ')} or ${readings[readings.length - 1]}`
      : readings[0];

  return {
    slot: contradiction.slot,
    question: `Which ${contradiction.slot} did you mean — ${choices}?`,
    options: readings.map((reading) => ({ label: reading, value: reading })),
  };
}

/**
 * Decide what to do about one candidate action.
 *
 * @param {object} args
 * @param {object} args.descriptor the registry descriptor (trusted). Supplies effect and slots
 * @param {string} args.intent the model's intent — an action id, or a NON_ACTION_INTENTS value
 * @param {'high'|'medium'|'low'} args.confidence ordinal, never a float (decision D9)
 * @param {'clear'|'close'} [args.margin='clear'] gap between the top-1 and top-2 intents
 * @param {string[]} [args.missing=[]] required slots the resolver could not fill
 * @param {{slot: string, readings: string[]}[]} [args.contradictions=[]]
 * @returns {{decision: 'prefill'|'ask'|'passthrough', reason?: string, ask?: object}}
 */
function decide({
  descriptor,
  intent,
  confidence,
  margin = 'clear',
  missing = [],
  contradictions = [],
} = {}) {
  // The model said it had no action for this, or named something that is not an
  // action at all. The coach is the universal fallback and no utterance ever
  // dead-ends, so this is a normal outcome rather than a failure.
  if (!intent || NON_ACTION_INTENTS.includes(intent)) {
    return { decision: 'passthrough', reason: 'not_an_action' };
  }

  // No descriptor means the id survived neither catalog membership nor the
  // registry. Defensive: the caller re-verifies membership before reaching
  // here (G4), and this is what happens if that check is ever removed.
  if (!descriptor) {
    return { decision: 'passthrough', reason: 'invalid_proposal' };
  }

  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }

  // Understood something, but not well enough to act on it. The teacher gets a
  // normal coaching answer, which is a perfectly good outcome — far better than
  // being dropped into the wrong form.
  if (confidence === 'low') {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }
  if (confidence === 'medium' && margin === 'close') {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }

  // Contradiction outranks a missing slot: only one question may be asked, and
  // "which class did you mean" matters more than "quiz or worksheet", because a
  // wrong class is invisible on the printed page and a wrong format is not.
  if (contradictions.length > 0) {
    return { decision: 'ask', ask: buildContradictionAsk(contradictions[0]) };
  }

  // The asymmetry below is counter-intuitive and correct: MORE missing
  // information means FEWER questions. One gap is a single chip tap. Two or
  // more gaps means the teacher needs to see the whole form — and the prefilled
  // form IS the disambiguation UI (architecture §2.3). A five-turn
  // conversational interrogation on a low-end phone is worse than one glance.
  if (missing.length === 1) {
    const slot = descriptor.slots.find((candidate) => candidate.name === missing[0]);
    // A required slot without an `ask` cannot be asked about; the registry
    // rejects that at boot, so this falls through to prefill only if the
    // registry validation is ever weakened.
    if (slot && slot.ask) {
      return { decision: 'ask', ask: buildMissingSlotAsk(slot) };
    }
  }

  const ceiling = effectCeiling(descriptor.effect, {
    autoExecute: descriptor.autoExecute,
    confidence,
    missingCount: missing.length,
  });

  return { decision: applyPhase1Clamp(ceiling) };
}

module.exports = {
  EFFECT_CEILING,
  effectCeiling,
  applyPhase1Clamp,
  buildMissingSlotAsk,
  buildContradictionAsk,
  decide,
};
