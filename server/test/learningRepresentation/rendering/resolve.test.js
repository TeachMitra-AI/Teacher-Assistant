// Renderable representation resolution — AI Learning Representation System,
// Phase C. Tests the composition described in the Phase B review answer:
// a representation is only offered when confidence AND renderer
// availability both hold.

const { EDUCATIONAL_INTENT_IDS } = require('../../../src/learningRepresentation/contracts');
const { INTENT_TO_REPRESENTATION } = require('../../../src/learningRepresentation/mapping');
const { VERBAL_EXPLANATION, LEARNING_REPRESENTATION_IDS } = require('../../../src/learningRepresentation/representations');
const { RENDERABLE_REPRESENTATION_IDS } = require('../../../src/learningRepresentation/rendering/schemas');
const { gateOnRenderer, resolveRenderableRepresentation } = require('../../../src/learningRepresentation/rendering/resolve');

describe('gateOnRenderer — the renderer-availability half of the gate', () => {
  test.each(RENDERABLE_REPRESENTATION_IDS)('%s passes through unchanged when mapped (a renderer exists)', (representation) => {
    const resolved = { representation, source: 'mapped' };
    expect(gateOnRenderer(resolved)).toEqual(resolved);
  });

  test('verbal_explanation always passes through, mapped or abstained, regardless of the registry', () => {
    expect(gateOnRenderer({ representation: VERBAL_EXPLANATION, source: 'mapped' })).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'mapped',
    });
    expect(gateOnRenderer({ representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'low_confidence' })).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'abstained',
      reason: 'low_confidence',
    });
  });

  test('a representation with no renderer degrades to verbal_explanation, reason renderer_unavailable', () => {
    // Every real representation in the current taxonomy DOES have a renderer
    // (Phase C shipped all six), so this exercises the gate with a
    // representation id that is valid in the taxonomy shape but deliberately
    // absent from the renderer registry — proving the gate is a real check,
    // not a pass-through disguised as one.
    expect(LEARNING_REPRESENTATION_IDS).not.toContain('future_representation_type');
    const resolved = { representation: 'future_representation_type', source: 'mapped' };
    expect(gateOnRenderer(resolved)).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'abstained',
      reason: 'renderer_unavailable',
    });
  });

  test('currently every non-verbal representation in the taxonomy has a renderer', () => {
    // Documents the current state (all six shipped in this phase) so this
    // test starts failing — a useful signal, not a bug — the day a seventh
    // representation is added to representations.js before its renderer
    // ships, which is exactly the scenario the gate exists to handle safely.
    expect([...RENDERABLE_REPRESENTATION_IDS].sort()).toEqual(
      LEARNING_REPRESENTATION_IDS.filter((id) => id !== VERBAL_EXPLANATION).sort()
    );
  });
});

describe('resolveRenderableRepresentation — full pipeline from a classifier result', () => {
  test.each(EDUCATIONAL_INTENT_IDS)('%s at high confidence resolves to its mapped, renderable representation', (intent) => {
    const result = resolveRenderableRepresentation({ ok: true, intent, confidence: 'high' });
    expect(result).toEqual({ representation: INTENT_TO_REPRESENTATION[intent], source: 'mapped' });
  });

  test('low confidence abstains, unaffected by the renderer gate', () => {
    const result = resolveRenderableRepresentation({ ok: true, intent: 'explain_process', confidence: 'low' });
    expect(result).toEqual({ representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'low_confidence' });
  });

  test('a classifier failure abstains, unaffected by the renderer gate', () => {
    const result = resolveRenderableRepresentation({ ok: false, reason: 'classifier_timeout' });
    expect(result).toEqual({ representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'classifier_timeout' });
  });

  test('no_visualization resolves to verbal_explanation without consulting the renderer registry', () => {
    const result = resolveRenderableRepresentation({ ok: true, intent: 'no_visualization', confidence: 'high' });
    expect(result).toEqual({ representation: VERBAL_EXPLANATION, source: 'mapped' });
  });
});
