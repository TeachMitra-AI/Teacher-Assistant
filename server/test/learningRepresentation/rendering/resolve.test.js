// Renderable representation resolution: a representation is offered only when confidence and renderer availability both hold.

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
    // Every real representation currently has a renderer, so this exercises the gate with an id that's valid in the
    // taxonomy shape but absent from the renderer registry, proving it's a real check and not a pass-through.
    expect(LEARNING_REPRESENTATION_IDS).not.toContain('future_representation_type');
    const resolved = { representation: 'future_representation_type', source: 'mapped' };
    expect(gateOnRenderer(resolved)).toEqual({
      representation: VERBAL_EXPLANATION,
      source: 'abstained',
      reason: 'renderer_unavailable',
    });
  });

  test('currently every non-verbal representation in the taxonomy has a renderer', () => {
    // Documents the current state (all six have renderers), so this starts failing, usefully, the day a seventh
    // representation is added to representations.js before its renderer ships, the scenario the gate handles safely.
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
