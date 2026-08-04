// Intent → Representation mapping — AI Learning Representation System,
// Phase B (docs/learning-representation-system-adr.md, §5, §13 Phase B).
//
// Wires the Phase A classifier's output to a Learning Representation. Two
// things happen here, kept in one small module because they are two halves
// of one decision:
//
//   1. THE MAPPING ITSELF — a deterministic 1:1 lookup, per ADR §5. Once
//      intent is known, representation is not a second judgment call, it is
//      a table read. This is what makes the same/similar prompt reliably
//      produce the same representation every time (ADR §12's "Consistency"
//      success metric) — there is no second model call here to be
//      inconsistent.
//
//   2. THE ABSTAIN POLICY — what to do with a classifier result that isn't a
//      confident, valid intent. Answered during Phase A review: because the
//      mapping is deterministic and every representation is a structured,
//      low-stakes suggestion (never a navigation, never a mutation — ADR
//      Product Principle 1), the policy can afford to be permissive next to
//      the AI Action Router's effect-dominated, precision-first policy
//      (server/src/assistant/policy.js). Concretely:
//        - 'high' or 'medium' confidence  → use the deterministic mapping
//        - 'low' confidence               → abstain (verbal_explanation)
//        - any classifier failure         → abstain (verbal_explanation)
//      Abstaining is never a special case to remember — it is just "resolve
//      to the same representation `no_visualization` would have produced,"
//      so a caller never needs to branch on ok/not-ok before deciding what
//      the teacher sees.
//
// Still no renderer (ADR §6 is Phase C) and no route (Phase D wires this to
// a UI). This module's output — a representation id — is not yet consumed by
// anything; it exists to be reviewed and tested in isolation before a
// renderer is built on top of it, per the ADR's own phrasing for Phase B.

const { EDUCATIONAL_INTENT_IDS } = require('./contracts');
const { LEARNING_REPRESENTATION_IDS, VERBAL_EXPLANATION } = require('./representations');

/**
 * The ADR §5 table, verbatim. A plain object rather than a Map: it is
 * serialized nowhere, iterated nowhere performance-sensitive, and a plain
 * object reads as directly as the ADR's own markdown table.
 */
const INTENT_TO_REPRESENTATION = Object.freeze({
  explain_process: 'process_diagram',
  compare_concepts: 'comparison_table',
  show_chronology: 'timeline',
  show_hierarchy: 'hierarchy_diagram',
  explain_structure: 'labeled_diagram',
  show_quantitative_data: 'graph_chart',
  no_visualization: VERBAL_EXPLANATION,
});

// ---- Completeness guard, enforced at load time, not just by a test -------
// A mapping with a missing or stray entry is exactly the kind of drift ADR
// §5 exists to prevent ("the only thing that can be wrong is the intent
// classification itself"). Throwing at require()-time means a future intent
// added to contracts.js without a matching mapping row fails on server boot,
// not on the first unlucky teacher request that happens to hit it — the same
// "fail loud, fail early" preference assistant/registry.js applies to a
// malformed action descriptor.
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

/**
 * The lowest confidence level the deterministic mapping is trusted at.
 * 'low' abstains; 'high' and 'medium' both proceed — see the module header
 * for why medium is not treated as a reason to suppress the suggestion.
 */
const MIN_CONFIDENCE_TO_MAP = 'medium';

/** Ordinal order, lowest first — matches contracts.js CONFIDENCE_LEVELS' meaning without importing it (see contracts.js's own note on why this feature stays self-contained). */
const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });

/**
 * Resolve a Phase A classifier result to a Learning Representation.
 *
 * Takes exactly the shape `classify()` returns, so a caller can pass its
 * result straight through with no glue code:
 *
 *   const classified = await classify({ gemini, prompt, requestId });
 *   const { representation, source } = resolveRepresentation(classified);
 *
 * @param {{ok: true, intent: string, confidence: string}|{ok: false, reason: string}} classified
 * @returns {{representation: string, source: 'mapped'|'abstained', reason?: string}}
 *   `source: 'abstained'` covers both a low-confidence result and a classifier
 *   failure; `reason` is only present for the latter (a PASSTHROUGH-style
 *   diagnostic string, never displayed — mirrors assistant's PASSTHROUGH_REASONS).
 */
function resolveRepresentation(classified) {
  if (!classified.ok) {
    return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: classified.reason };
  }

  if (CONFIDENCE_RANK[classified.confidence] < CONFIDENCE_RANK[MIN_CONFIDENCE_TO_MAP]) {
    return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'low_confidence' };
  }

  // classified.intent is already re-verified against EDUCATIONAL_INTENT_IDS
  // by parseResult() before classify() can return ok:true, and the
  // completeness guard above proves every valid intent has a mapping entry —
  // so this lookup cannot miss. No `|| VERBAL_EXPLANATION` fallback here on
  // purpose: a silent fallback would hide the day this invariant breaks.
  return { representation: INTENT_TO_REPRESENTATION[classified.intent], source: 'mapped' };
}

module.exports = {
  INTENT_TO_REPRESENTATION,
  MIN_CONFIDENCE_TO_MAP,
  resolveRepresentation,
};
