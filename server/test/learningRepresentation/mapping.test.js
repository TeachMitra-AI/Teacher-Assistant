// Intent → Representation mapping — AI Learning Representation System,
// Phase B (docs/learning-representation-system-adr.md, §5, §13 Phase B).
//
// Two things matter here more than most test files: the mapping must match
// ADR §5's table EXACTLY (a silent drift here is the single most consequential
// bug this feature could ship, per the ADR's own "Wrong representation"
// risk), and the abstain policy from the Phase A review answer (medium
// proceeds, low and every failure abstain) must be exercised for every
// intent and every failure reason, not just spot-checked.

const { EDUCATIONAL_INTENT_IDS } = require('../../src/learningRepresentation/contracts');
const { LEARNING_REPRESENTATION_IDS, VERBAL_EXPLANATION } = require('../../src/learningRepresentation/representations');
const { INTENT_TO_REPRESENTATION, resolveRepresentation } = require('../../src/learningRepresentation/mapping');

describe('INTENT_TO_REPRESENTATION matches ADR §5 exactly', () => {
  test('the full table', () => {
    expect(INTENT_TO_REPRESENTATION).toEqual({
      explain_process: 'process_diagram',
      compare_concepts: 'comparison_table',
      show_chronology: 'timeline',
      show_hierarchy: 'hierarchy_diagram',
      explain_structure: 'labeled_diagram',
      show_quantitative_data: 'graph_chart',
      no_visualization: 'verbal_explanation',
    });
  });

  test('every Educational Intent has exactly one mapped representation', () => {
    const mapped = Object.keys(INTENT_TO_REPRESENTATION);
    expect(mapped.sort()).toEqual([...EDUCATIONAL_INTENT_IDS].sort());
  });

  test('every mapped representation exists in the representation taxonomy', () => {
    for (const representationId of Object.values(INTENT_TO_REPRESENTATION)) {
      expect(LEARNING_REPRESENTATION_IDS).toContain(representationId);
    }
  });

  test('the mapping is frozen', () => {
    expect(Object.isFrozen(INTENT_TO_REPRESENTATION)).toBe(true);
  });
});

describe('resolveRepresentation — confident results use the deterministic mapping', () => {
  test.each(EDUCATIONAL_INTENT_IDS)('%s at high confidence resolves via the table', (intent) => {
    const result = resolveRepresentation({ ok: true, intent, confidence: 'high' });
    expect(result).toEqual({ representation: INTENT_TO_REPRESENTATION[intent], source: 'mapped' });
  });

  test.each(EDUCATIONAL_INTENT_IDS)('%s at medium confidence ALSO resolves via the table (not suppressed)', (intent) => {
    // Medium is deliberately not treated as a reason to abstain — see the
    // module header for why (representations are low-stakes suggestions,
    // unlike the Action Router's effect-dominated policy).
    const result = resolveRepresentation({ ok: true, intent, confidence: 'medium' });
    expect(result).toEqual({ representation: INTENT_TO_REPRESENTATION[intent], source: 'mapped' });
  });
});

describe('resolveRepresentation — low confidence abstains regardless of intent', () => {
  test.each(EDUCATIONAL_INTENT_IDS)('%s at low confidence abstains to verbal_explanation', (intent) => {
    const result = resolveRepresentation({ ok: true, intent, confidence: 'low' });
    expect(result).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'abstained',
      reason: 'low_confidence',
    });
  });
});

describe('resolveRepresentation — every classifier failure abstains', () => {
  const failureReasons = [
    'classifier_timeout',
    'classifier_error',
    'safety_blocked',
    'invalid_result',
  ];

  test.each(failureReasons)('%s abstains to verbal_explanation, reason passed through', (reason) => {
    const result = resolveRepresentation({ ok: false, reason });
    expect(result).toEqual({ representation: VERBAL_EXPLANATION, source: 'abstained', reason });
  });
});

describe('resolveRepresentation — no_visualization always resolves to verbal_explanation', () => {
  test('at high confidence', () => {
    expect(resolveRepresentation({ ok: true, intent: 'no_visualization', confidence: 'high' })).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'mapped',
    });
  });
});
