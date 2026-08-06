// The Learning Representation taxonomy — AI Learning Representation System,
// Phase B (docs/learning-representation-system-adr.md, §4).

const {
  LEARNING_REPRESENTATIONS,
  LEARNING_REPRESENTATION_IDS,
  VERBAL_EXPLANATION,
} = require('../../src/learningRepresentation/representations');

describe('the representation taxonomy', () => {
  test('has exactly the seven representations defined in ADR §4', () => {
    expect(LEARNING_REPRESENTATION_IDS).toEqual([
      'verbal_explanation',
      'process_diagram',
      'comparison_table',
      'timeline',
      'hierarchy_diagram',
      'labeled_diagram',
      'graph_chart',
    ]);
  });

  test('every representation carries a non-empty purpose', () => {
    for (const representation of LEARNING_REPRESENTATIONS) {
      expect(typeof representation.purpose).toBe('string');
      expect(representation.purpose.length).toBeGreaterThan(0);
    }
  });

  test('VERBAL_EXPLANATION is the exported constant, not a re-typed literal', () => {
    expect(VERBAL_EXPLANATION).toBe('verbal_explanation');
    expect(LEARNING_REPRESENTATION_IDS).toContain(VERBAL_EXPLANATION);
  });

  test('the taxonomy is frozen at every level', () => {
    expect(Object.isFrozen(LEARNING_REPRESENTATIONS)).toBe(true);
    expect(Object.isFrozen(LEARNING_REPRESENTATIONS[0])).toBe(true);
    expect(Object.isFrozen(LEARNING_REPRESENTATION_IDS)).toBe(true);
  });
});
