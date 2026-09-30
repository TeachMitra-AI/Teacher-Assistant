// The decision policy: signals in, decision out. Pure, so the truth table in the tests is a full specification.
// Only the model's ordinal confidence comes from the model; slot completeness, contradictions and effect
// class are computed by the application, so the policy doesn't inherit the model's failure modes.
// Effect dominates confidence: the registry-declared effect caps what may happen at any confidence, and is
// applied first. No model output can escalate its own consequences.

// PHASE1_DECISIONS isn't imported or re-exported here; contracts.js stays its only import path.
const { CONFIDENCE_LEVELS, NON_ACTION_INTENTS } = require('./contracts');

/**
 * The most an action may do, by effect class.
 *   read         navigation and search; safe to just do
 *   draft        prepares something a human then reviews and commits
 *   write        prefill plus an explicit human commit, never automatic
 *   destructive  prefill at most; never pre-arm or confirm on the user's behalf
 */
const EFFECT_CEILING = Object.freeze({
  read: 'execute',
  draft: 'prefill',
  write: 'prefill',
  destructive: 'prefill',
});

/** Unknown effects get the most restrictive ceiling. */
const UNKNOWN_EFFECT_CEILING = 'prefill';

/**
 * The ceiling for one action. A `draft` action is raised to `execute` only when every auto-execute
 * condition holds; `autoExecute` is false on every descriptor today and validated at boot, so
 * this branch is unreachable until auto-generation is enabled.
 */
function effectCeiling(effect, { autoExecute = false, confidence = 'low', missingCount = 0 } = {}) {
  const ceiling = EFFECT_CEILING[effect] || UNKNOWN_EFFECT_CEILING;

  if (ceiling === 'prefill' && effect === 'draft') {
    if (autoExecute === true && confidence === 'high' && missingCount === 0) return 'execute';
  }

  return ceiling;
}

/**
 * Reduce a decision to what is currently allowed to be sent. `execute` and `suggest` are defined in
 * the contract but never emitted. Applied last so no earlier branch can leak `execute`.
 */
function applyPhase1Clamp(decision) {
  if (decision === 'execute' || decision === 'suggest') return 'prefill';
  return decision;
}

/**
 * Build the one question allowed for a missing required slot. Chips come from the descriptor, so
 * what is offered matches what the schema accepts. A chip answer is resolved on the client.
 */
function buildMissingSlotAsk(slot) {
  const ask = { slot: slot.name, question: slot.ask };
  if (Array.isArray(slot.askOptions) && Array.isArray(slot.values)) {
    ask.options = slot.askOptions.map((label, index) => ({ label, value: slot.values[index] }));
  }
  return ask;
}

/**
 * Build the question for a contradiction, presenting both readings rather than guessing (a wrong
 * class prints fine and goes unnoticed). Options use the canonical readings; the client may swap in
 * its own label for codes such as language, but sends back the value offered here.
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
 * @param {object} args.descriptor the registry descriptor (trusted); supplies effect and slots
 * @param {string} args.intent an action id, or a NON_ACTION_INTENTS value
 * @param {'high'|'medium'|'low'} args.confidence ordinal, never a float
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
  // No action for this: a normal outcome, since the coach is the universal fallback.
  if (!intent || NON_ACTION_INTENTS.includes(intent)) {
    return { decision: 'passthrough', reason: 'not_an_action' };
  }

  // Defensive: the caller already checked catalog membership.
  if (!descriptor) {
    return { decision: 'passthrough', reason: 'invalid_proposal' };
  }

  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }

  // Not understood well enough to act on; a coaching answer beats the wrong form.
  if (confidence === 'low') {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }
  if (confidence === 'medium' && margin === 'close') {
    return { decision: 'passthrough', reason: 'low_confidence' };
  }

  // A contradiction outranks a missing slot: only one question is asked, and a wrong class is invisible on the printed page.
  if (contradictions.length > 0) {
    return { decision: 'ask', ask: buildContradictionAsk(contradictions[0]) };
  }

  // More missing information means fewer questions: one gap is a chip tap, but two or more need the
  // full prefilled form, which is itself the disambiguation UI.
  if (missing.length === 1) {
    const slot = descriptor.slots.find((candidate) => candidate.name === missing[0]);
    // A slot without an `ask` can't be asked about; the registry rejects that at boot.
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
