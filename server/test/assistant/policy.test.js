// The decision policy. The input space is small, so this file enumerates it completely: every effect class x confidence
// x margin x completeness case x contradiction. That's stronger than branch coverage and needs no coverage tooling.
// Two layers:
//   1. A table of named rows with literal expected outputs and no logic: the pinned specification.
//   2. An exhaustive sweep asserting the safety invariants for every input, above all that no combination, at any confidence, produces `execute`.

const { PHASE1_DECISIONS, CONFIDENCE_LEVELS, EFFECTS } = require('../../src/assistant/contracts');
const { generateAssessment } = require('../../src/actions/descriptors/generateAssessment');
const { openGenerator } = require('../../src/actions/descriptors/openGenerator');
const {
  EFFECT_CEILING,
  effectCeiling,
  applyPhase1Clamp,
  buildMissingSlotAsk,
  buildContradictionAsk,
  decide,
} = require('../../src/assistant/policy');

/** A descriptor with an arbitrary effect, including ones the registry forbids today. */
const withEffect = (effect, extra = {}) => ({ ...generateAssessment, effect, ...extra });

const CONTRADICTION = { slot: 'grade', readings: ['Class 3-5', 'Class 6-8'] };

describe('Rule 0 — the effect ceiling', () => {
  test('the ceiling table matches the approved architecture', () => {
    expect(EFFECT_CEILING).toEqual({
      read: 'execute',
      draft: 'prefill',
      write: 'prefill',
      destructive: 'prefill',
    });
  });

  test('every effect in the frozen contract has a ceiling', () => {
    for (const effect of EFFECTS) {
      expect(EFFECT_CEILING[effect], `${effect} has no ceiling`).toBeDefined();
    }
  });

  test('an unknown effect gets the most restrictive ceiling, not the most permissive', () => {
    expect(effectCeiling('something_new')).toBe('prefill');
    expect(effectCeiling(undefined)).toBe('prefill');
  });

  test('destructive never exceeds prefill at ANY confidence, with or without autoExecute', () => {
    // The single most important assertion in this file. It is what makes a
    // misclassification cost one tap rather than a deleted resource.
    for (const confidence of CONFIDENCE_LEVELS) {
      for (const autoExecute of [true, false]) {
        expect(effectCeiling('destructive', { autoExecute, confidence, missingCount: 0 })).toBe('prefill');
        expect(effectCeiling('write', { autoExecute, confidence, missingCount: 0 })).toBe('prefill');
      }
    }
  });

  test('the draft graduation branch exists and requires everything at once', () => {
    // Flipping autoExecute is the one field that turns on auto-generation. Testing it now makes that a flag flip rather
    // than a policy designed under deadline pressure, and it's still clamped away below.
    const graduated = { autoExecute: true, confidence: 'high', missingCount: 0 };
    expect(effectCeiling('draft', graduated)).toBe('execute');

    expect(effectCeiling('draft', { ...graduated, autoExecute: false })).toBe('prefill');
    expect(effectCeiling('draft', { ...graduated, confidence: 'medium' })).toBe('prefill');
    expect(effectCeiling('draft', { ...graduated, missingCount: 1 })).toBe('prefill');
  });
});

describe('the Phase 1 clamp', () => {
  test('execute and suggest are reduced to prefill', () => {
    expect(applyPhase1Clamp('execute')).toBe('prefill');
    expect(applyPhase1Clamp('suggest')).toBe('prefill');
  });

  test('the decisions Phase 1 does emit pass through untouched', () => {
    for (const decision of PHASE1_DECISIONS) {
      expect(applyPhase1Clamp(decision)).toBe(decision);
    }
  });

  test('the clamp is load-bearing, not decorative', () => {
    // A `read` action's ceiling IS execute. Only the clamp stops it being
    // emitted, so this asserts the clamp actually stands between them.
    expect(effectCeiling(openGenerator.effect)).toBe('execute');
    expect(decide({ descriptor: openGenerator, intent: openGenerator.id, confidence: 'high' }).decision).toBe(
      'prefill'
    );
  });

  test('even a graduated draft action is clamped in Phase 1', () => {
    const graduated = withEffect('draft', { autoExecute: true });
    expect(decide({ descriptor: graduated, intent: graduated.id, confidence: 'high' }).decision).toBe('prefill');
  });
});

describe('the decision table — explicit rows', () => {
  const ROWS = [
    {
      name: 'a coaching question passes through',
      input: { descriptor: generateAssessment, intent: 'coach_question', confidence: 'high' },
      expected: { decision: 'passthrough', reason: 'not_an_action' },
    },
    {
      name: 'an unknown intent passes through',
      input: { descriptor: generateAssessment, intent: 'unknown', confidence: 'high' },
      expected: { decision: 'passthrough', reason: 'not_an_action' },
    },
    {
      name: 'a missing intent passes through',
      input: { descriptor: generateAssessment, intent: undefined, confidence: 'high' },
      expected: { decision: 'passthrough', reason: 'not_an_action' },
    },
    {
      name: 'an action id with no descriptor passes through as an invalid proposal',
      input: { descriptor: undefined, intent: 'generate_assessment', confidence: 'high' },
      expected: { decision: 'passthrough', reason: 'invalid_proposal' },
    },
    {
      name: 'low confidence passes through',
      input: { descriptor: generateAssessment, intent: 'generate_assessment', confidence: 'low' },
      expected: { decision: 'passthrough', reason: 'low_confidence' },
    },
    {
      name: 'a confidence value outside the contract passes through',
      input: { descriptor: generateAssessment, intent: 'generate_assessment', confidence: 0.87 },
      expected: { decision: 'passthrough', reason: 'low_confidence' },
    },
    {
      name: 'medium confidence with a close margin passes through',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'medium',
        margin: 'close',
      },
      expected: { decision: 'passthrough', reason: 'low_confidence' },
    },
    {
      name: 'medium confidence with a clear margin acts',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'medium',
        margin: 'clear',
      },
      expected: { decision: 'prefill' },
    },
    {
      name: 'everything present and understood prefills',
      input: { descriptor: generateAssessment, intent: 'generate_assessment', confidence: 'high' },
      expected: { decision: 'prefill' },
    },
    {
      name: 'exactly one missing required slot asks',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'high',
        missing: ['format'],
      },
      expected: { decision: 'ask' },
    },
    {
      name: 'two missing required slots prefill — the form is the question',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'high',
        missing: ['format', 'topic'],
      },
      expected: { decision: 'prefill' },
    },
    {
      name: 'a contradiction asks',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'high',
        contradictions: [CONTRADICTION],
      },
      expected: { decision: 'ask' },
    },
    {
      name: 'a contradiction outranks a missing slot — only one question may be asked',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'high',
        missing: ['format'],
        contradictions: [CONTRADICTION],
      },
      expected: { decision: 'ask', askSlot: 'grade' },
    },
    {
      name: 'low confidence outranks a contradiction — nothing worth asking about',
      input: {
        descriptor: generateAssessment,
        intent: 'generate_assessment',
        confidence: 'low',
        contradictions: [CONTRADICTION],
      },
      expected: { decision: 'passthrough', reason: 'low_confidence' },
    },
  ];

  test.each(ROWS)('$name', ({ input, expected }) => {
    const result = decide(input);
    expect(result.decision).toBe(expected.decision);
    if (expected.reason) expect(result.reason).toBe(expected.reason);
    if (expected.askSlot) expect(result.ask.slot).toBe(expected.askSlot);
  });
});

describe('the decision table — exhaustive enumeration', () => {
  // The complete input space. Every combination is generated, not sampled.
  const MARGINS = ['clear', 'close'];
  const MISSING_CASES = [[], ['format'], ['format', 'topic']];
  const CONTRADICTION_CASES = [[], [CONTRADICTION]];

  const COMBINATIONS = [];
  for (const effect of EFFECTS) {
    for (const confidence of CONFIDENCE_LEVELS) {
      for (const margin of MARGINS) {
        for (const missing of MISSING_CASES) {
          for (const contradictions of CONTRADICTION_CASES) {
            for (const autoExecute of [false, true]) {
              COMBINATIONS.push({ effect, confidence, margin, missing, contradictions, autoExecute });
            }
          }
        }
      }
    }
  }

  /**
   * The approved ordering, transcribed as rules rather than code paths and kept independent of the implementation, so
   * a disagreement between the two is visible.
   */
  function expectedDecision({ confidence, margin, missing, contradictions }) {
    if (!CONFIDENCE_LEVELS.includes(confidence)) return 'passthrough';
    if (confidence === 'low') return 'passthrough';
    if (confidence === 'medium' && margin === 'close') return 'passthrough';
    if (contradictions.length > 0) return 'ask';
    if (missing.length === 1) return 'ask';
    return 'prefill';
  }

  test('the enumeration covers the whole input space', () => {
    // 4 effects x 3 confidences x 2 margins x 3 completeness x 2 contradiction x 2 autoExecute; asserted so narrowing a dimension can't quietly shrink the sweep.
    expect(COMBINATIONS).toHaveLength(4 * 3 * 2 * 3 * 2 * 2);
  });

  test('every combination produces the decision the specification calls for', () => {
    for (const combination of COMBINATIONS) {
      const result = decide({
        descriptor: withEffect(combination.effect, { autoExecute: combination.autoExecute }),
        intent: 'generate_assessment',
        confidence: combination.confidence,
        margin: combination.margin,
        missing: combination.missing,
        contradictions: combination.contradictions,
      });

      expect(result.decision, JSON.stringify(combination)).toBe(expectedDecision(combination));
    }
  });

  test('no combination whatsoever can emit execute or suggest', () => {
    for (const combination of COMBINATIONS) {
      const result = decide({
        descriptor: withEffect(combination.effect, { autoExecute: combination.autoExecute }),
        intent: 'generate_assessment',
        confidence: combination.confidence,
        margin: combination.margin,
        missing: combination.missing,
        contradictions: combination.contradictions,
      });

      expect(PHASE1_DECISIONS, JSON.stringify(combination)).toContain(result.decision);
    }
  });

  test('no combination ever throws', () => {
    // This function sits in front of a text box, so it must always return an answer.
    for (const combination of COMBINATIONS) {
      expect(() =>
        decide({
          descriptor: withEffect(combination.effect),
          intent: 'generate_assessment',
          confidence: combination.confidence,
          margin: combination.margin,
          missing: combination.missing,
          contradictions: combination.contradictions,
        })
      ).not.toThrow();
    }
  });

  test('decide tolerates being called with nothing at all', () => {
    expect(decide()).toEqual({ decision: 'passthrough', reason: 'not_an_action' });
  });
});

describe('the question that gets asked', () => {
  const format = generateAssessment.slots.find((slot) => slot.name === 'format');
  const topic = generateAssessment.slots.find((slot) => slot.name === 'topic');

  test('an enum slot offers chips built from the descriptor', () => {
    // Chips come from the registry, so what is offered and what the schema
    // accepts cannot disagree.
    expect(buildMissingSlotAsk(format)).toEqual({
      slot: 'format',
      question: 'Quiz or worksheet?',
      options: [
        { label: 'Quiz', value: 'quiz' },
        { label: 'Worksheet', value: 'worksheet' },
      ],
    });
  });

  test('a free-text slot asks without offering options', () => {
    expect(buildMissingSlotAsk(topic)).toEqual({
      slot: 'topic',
      question: 'What topic should it cover?',
    });
  });

  test('the ask matches the documented specification payload exactly', () => {
    const documented = require('../helpers/assistantFixtures').interpretAskResponse.actions[0].ask;
    const result = decide({
      descriptor: generateAssessment,
      intent: 'generate_assessment',
      confidence: 'high',
      missing: ['format'],
    });
    expect(result.ask).toEqual(documented);
  });

  test('a contradiction presents BOTH readings', () => {
    // Never "pick the first and carry on": a guessed contradiction produces a
    // worksheet that looks correct and is for the wrong class.
    expect(buildContradictionAsk(CONTRADICTION)).toEqual({
      slot: 'grade',
      question: 'Which grade did you mean — Class 3-5 or Class 6-8?',
      options: [
        { label: 'Class 3-5', value: 'Class 3-5' },
        { label: 'Class 6-8', value: 'Class 6-8' },
      ],
    });
  });

  test('three readings are listed without losing one', () => {
    const ask = buildContradictionAsk({ slot: 'subject', readings: ['Mathematics', 'Science', 'English'] });
    expect(ask.question).toBe('Which subject did you mean — Mathematics, Science or English?');
    expect(ask.options).toHaveLength(3);
  });

  test('a required slot with no question falls back to prefill rather than asking nothing', () => {
    // The registry rejects a required slot with no `ask` at boot, so this is reachable only if that validation weakens. It
    // degrades to a prefilled form, never a question with no text.
    const broken = {
      ...generateAssessment,
      slots: [{ name: 'topic', type: 'text', required: true }],
    };
    expect(decide({ descriptor: broken, intent: 'x', confidence: 'high', missing: ['topic'] }).decision).toBe(
      'prefill'
    );
  });
});
