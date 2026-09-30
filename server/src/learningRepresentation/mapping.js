// Intent -> representation mapping, plus the abstain policy for results that aren't a confident, valid intent.
// The mapping is a deterministic 1:1 lookup, so the same prompt reliably gives the same representation.
// Abstain policy: 'high' or 'medium' confidence uses the mapping; 'low' confidence or any classifier failure
// abstains to verbal_explanation. Representations are low-stakes suggestions, so this is more permissive than
// the assistant policy. Abstaining resolves to the same representation `no_visualization` would, so callers never branch on ok.

const { EDUCATIONAL_INTENT_IDS } = require('./contracts');
const { LEARNING_REPRESENTATION_IDS, VERBAL_EXPLANATION } = require('./representations');

/** The intent -> representation table (docs/learning-representation-system-adr.md). */
const INTENT_TO_REPRESENTATION = Object.freeze({
  explain_process: 'process_diagram',
  compare_concepts: 'comparison_table',
  show_chronology: 'timeline',
  show_hierarchy: 'hierarchy_diagram',
  explain_structure: 'labeled_diagram',
  show_quantitative_data: 'graph_chart',
  no_visualization: VERBAL_EXPLANATION,
});

// Completeness guard: a missing or stray entry throws at require() time, so a new intent without a
// mapping fails on boot, not on the first request that hits it.
{
  const mapped = Object.keys(INTENT_TO_REPRESENTATION);
  const missing = EDUCATIONAL_INTENT_IDS.filter((id) => !mapped.includes(id));
  const stray = mapped.filter((id) => !EDUCATIONAL_INTENT_IDS.includes(id));
  if (missing.length > 0 || stray.length > 0) {
    throw new Error(
      `learningRepresentation/mapping.js: INTENT_TO_REPRESENTATION is out of sync with the ` +
        `taxonomy in contracts.js (missing: [${missing.join(', ')}], stray: [${stray.join(', ')}]).`
    );
  }
  const invalidTargets = Object.values(INTENT_TO_REPRESENTATION).filter(
    (representationId) => !LEARNING_REPRESENTATION_IDS.includes(representationId)
  );
  if (invalidTargets.length > 0) {
    throw new Error(
      `learningRepresentation/mapping.js: INTENT_TO_REPRESENTATION points at an unknown ` +
        `representation id: [${invalidTargets.join(', ')}].`
    );
  }
}

/** Lowest confidence the mapping is trusted at; 'low' abstains. */
const MIN_CONFIDENCE_TO_MAP = 'medium';

/** Ordinal order, lowest first — matches contracts.js CONFIDENCE_LEVELS' meaning without importing it (see contracts.js's own note on why this feature stays self-contained). */
const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });

/**
 * Resolve a classifier result to a representation. Takes the shape `classify()` returns directly.
 *
 * @param {{ok: true, intent: string, confidence: string}|{ok: false, reason: string}} classified
 * @returns {{representation: string, source: 'mapped'|'abstained', reason?: string}}
 *   `source: 'abstained'` covers low confidence and classifier failure; `reason` is only set for the
 *   latter and is diagnostic, never displayed.
 */
function resolveRepresentation(classified) {
  if (!classified.ok) {
    return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: classified.reason };
  }

  if (CONFIDENCE_RANK[classified.confidence] < CONFIDENCE_RANK[MIN_CONFIDENCE_TO_MAP]) {
    return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'low_confidence' };
  }

  // The intent was already verified by parseResult() and the guard above covers every intent, so this can't miss.
  // No fallback on purpose: it would hide the day that invariant breaks.
  return { representation: INTENT_TO_REPRESENTATION[classified.intent], source: 'mapped' };
}

module.exports = {
  INTENT_TO_REPRESENTATION,
  MIN_CONFIDENCE_TO_MAP,
  resolveRepresentation,
};
