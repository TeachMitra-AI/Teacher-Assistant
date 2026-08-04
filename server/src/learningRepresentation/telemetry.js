// AI Learning Representation System — telemetry (ADR Phase D).
//
// Metadata-only structured stdout log, one line per request. Mirrors
// assistant/telemetry.js's channel-1 discipline exactly: NEVER carries the
// teacher's prompt, the answer text, or any generated structured content —
// only ids, enum values, counts and latencies (the `metrics` objects
// classify()/render() already return, both of which are metadata by
// construction — see their own module docs).
//
// No `Event` table writes in this phase. assistant/telemetry.js's own
// precedent is TWO channels: high-volume stdout for every routine decision,
// and low-volume `Event` rows reserved for rarer, CLIENT-CONFIRMED outcomes
// (e.g. "the prefill was actually shown and here's what the teacher did with
// it"). There is no equivalent client-confirmed signal in this first slice —
// nothing yet reports back "the teacher expanded/used the shown
// representation" — so introducing Event rows now would mean writing one per
// request with no corresponding low-volume signal to justify it, repeating
// the exact anti-pattern CHANGE-6 (assistant/telemetry.js's own header) was
// created to avoid. Add it when a real client-confirmed outcome exists to
// record.

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} event
 * @param {object} [meta]
 */
function logLearningRepresentationEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[learningRepresentation] ${event}`, meta);
}

/**
 * Reason codes worth a 'warn' rather than 'info' — genuine failures
 * (upstream errors, malformed output) as opposed to expected, healthy
 * outcomes (feature disabled, budget spent, classifier correctly abstained).
 * A caller decides the level from this list rather than guessing per call
 * site, so "is this reason routine or notable" has exactly one answer.
 */
const NOTABLE_REASONS = Object.freeze([
  'classifier_timeout',
  'classifier_error',
  'safety_blocked',
  'invalid_result',
  'render_timeout',
  'render_error',
  'invalid_content',
  'invalid_representation',
  'misconfigured',
]);

/** @param {string} [reason] @returns {'info'|'warn'} */
function levelForReason(reason) {
  return NOTABLE_REASONS.includes(reason) ? 'warn' : 'info';
}

module.exports = { logLearningRepresentationEvent, levelForReason, NOTABLE_REASONS };
