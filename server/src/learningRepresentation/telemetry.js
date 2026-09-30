// Metadata-only structured stdout log, one line per request, as in assistant/telemetry.js. Never carries the
// prompt, the answer, or generated content, only ids, enum values, counts and latencies.
// No `Event` rows yet: they are reserved for client-confirmed outcomes, and there is no such signal to justify
// writing one per request.

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
 * Reason codes worth a 'warn': genuine failures (upstream errors, malformed output), as opposed to routine
 * outcomes (feature disabled, budget spent, classifier abstained).
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
