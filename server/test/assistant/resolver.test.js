// The resolver (Milestone M4).
//
// Three things are being pinned here, in rising order of importance:
//
//   1. Precedence and provenance — utterance > memory > profile > default, with
//      every value recording where it came from.
//   2. The drop-don't-guess discipline — a value the action's own schema will
//      not accept is dropped, never clamped, coerced or approximated.
//   3. FIXTURE CONFORMANCE — the resolver reproduces the example payloads in
//      the approved specification (§7.2), which live in
//      test/helpers/assistantFixtures.js. This is the M2 precedent: a documented
//      example that nothing asserts is how a spec quietly stops being true.

const { z } = require('zod');

const { generateAssessment } = require('../../src/actions/descriptors/generateAssessment');
const { openGenerator } = require('../../src/actions/descriptors/openGenerator');
const { generateAssessmentSchema } = require('../../src/actions/schemas/generateAssessment');
const { interpretRequest, interpretPrefillResponse, interpretAskResponse } = require('../helpers/assistantFixtures');
const {
  MEMORY_TTL_TURNS,
  DEFAULT_MEMORY_TTL_TURNS,
  isMemoryFresh,
  canonicalizeSlot,
  readDefault,
  resolveSlots,
} = require('../../src/assistant/resolver');

/** A remembered slot as the client sends it. */
const remember = (value, turn) => ({ value, source: 'utterance', turn });

/**
 * A descriptor built for a case the live registry cannot produce — a `write`
 * action, or a slot with no TTL of its own. Constructing one here rather than
 * adding it to the registry is the point: Phase 1 must not contain a write
 * action, but the rules that protect against one have to be tested now.
 */
function syntheticDescriptor({ effect = 'write', slots, schema }) {
  return {
    id: 'synthetic_action',
    version: 1,
    status: 'active',
    domain: 'test',
    effect,
    requiredRoles: [],
    featureFlag: 'ASSISTANT_ACTION_SYNTHETIC',
    autoExecute: false,
    summary: 'Test-only descriptor.',
    examples: ['a', 'b', 'c', 'd', 'e'],
    slots,
    paramSchema: schema,
  };
}

describe('resolveSlots — precedence', () => {
  test('an explicit utterance value beats everything else', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5' },
      memory: { grade: remember('Class 9-10', 1) },
      profile: { defaultGrade: 'Class 6-8' },
      turn: 2,
    });

    expect(result.params.grade).toBe('Class 3-5');
    expect(result.provenance.grade).toBe('utterance');
  });

  test('memory is used when the utterance says nothing', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      memory: { grade: remember('Class 9-10', 1) },
      profile: { defaultGrade: 'Class 6-8' },
      turn: 2,
    });

    expect(result.params.grade).toBe('Class 9-10');
    expect(result.provenance.grade).toBe('memory');
  });

  test('the profile is used when neither the utterance nor memory has it', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      profile: { defaultGrade: 'Class 6-8' },
      turn: 2,
    });

    expect(result.params.grade).toBe('Class 6-8');
    expect(result.provenance.grade).toBe('profile');
  });

  test('the registry default is the last resort, and is typed correctly', () => {
    const result = resolveSlots({ descriptor: generateAssessment });

    expect(result.params.difficulty).toBe('medium');
    expect(result.provenance.difficulty).toBe('default');
    // `const:10` must arrive as a NUMBER. As the string "10" it fails
    // z.number() and the field would silently go unfilled.
    expect(result.params.questionCount).toBe(10);
    expect(typeof result.params.questionCount).toBe('number');
  });

  test('sources are never blended — one value, one provenance, per field', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5', topic: 'Fractions' },
      memory: { grade: remember('Class 9-10', 1), subject: remember('Science', 1) },
      profile: { defaultGrade: 'Class 6-8', defaultSubject: 'Mathematics' },
      turn: 2,
    });

    expect(Object.keys(result.provenance).sort()).toEqual(Object.keys(result.params).sort());
    expect(result.provenance).toMatchObject({ grade: 'utterance', subject: 'memory' });
  });
});

describe('resolveSlots — memory expiry', () => {
  test('a topic goes stale after two turns', () => {
    // The shortest TTL in the table, and the one that matters most: a stale
    // topic produces a confident, plausible, WRONG worksheet.
    const inTime = resolveSlots({
      descriptor: generateAssessment,
      memory: { topic: remember('Fractions', 1) },
      turn: 3,
    });
    expect(inTime.params.topic).toBe('Fractions');

    const tooLate = resolveSlots({
      descriptor: generateAssessment,
      memory: { topic: remember('Fractions', 1) },
      turn: 4,
    });
    expect(tooLate.params.topic).toBeUndefined();
    expect(tooLate.missing).toContain('topic');
  });

  test('format lasts three turns', () => {
    const base = { descriptor: generateAssessment, memory: { format: remember('quiz', 1) } };
    expect(resolveSlots({ ...base, turn: 4 }).params.format).toBe('quiz');
    expect(resolveSlots({ ...base, turn: 5 }).params.format).toBeUndefined();
  });

  test('grade, subject and language are session-lived', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      memory: {
        grade: remember('Class 3-5', 1),
        subject: remember('Mathematics', 1),
        language: remember('hi', 1),
      },
      turn: 500,
    });

    expect(result.params).toMatchObject({
      grade: 'Class 3-5',
      subject: 'Mathematics',
      language: 'hi',
    });
  });

  test('memory that cannot prove its own freshness is not used', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      memory: { topic: { value: 'Fractions', source: 'utterance' } },
      turn: 3,
    });
    expect(result.params.topic).toBeUndefined();
  });

  test('a slot with no TTL of its own gets the shortest one, not the longest', () => {
    // A new slot should have to earn a long memory rather than inherit one by
    // being forgotten about in the table.
    expect(MEMORY_TTL_TURNS.newSlot).toBeUndefined();
    expect(isMemoryFresh('newSlot', { turn: 1 }, 1 + DEFAULT_MEMORY_TTL_TURNS)).toBe(true);
    expect(isMemoryFresh('newSlot', { turn: 1 }, 2 + DEFAULT_MEMORY_TTL_TURNS)).toBe(false);
  });

  test('memory never satisfies a required slot for a write action', () => {
    const descriptor = syntheticDescriptor({
      effect: 'write',
      slots: [{ name: 'target', type: 'text', required: true, ask: 'Which one?', defaultFrom: null }],
      schema: z.object({ target: z.string().min(1) }).strict(),
    });

    const result = resolveSlots({
      descriptor,
      memory: { target: remember('something remembered', 1) },
      turn: 1,
    });

    expect(result.params.target).toBeUndefined();
    expect(result.missing).toEqual(['target']);
  });
});

describe('resolveSlots — ambiguity and contradiction', () => {
  test('an ambiguous grade prefills the teacher’s own words and flags the field', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5-6' },
      profile: { defaultGrade: 'Class 6-8' },
    });

    expect(result.params.grade).toBe('class 5-6');
    expect(result.provenance.grade).toBe('utterance');
    expect(result.lowConfidenceFields).toEqual(['grade']);
  });

  test('an ambiguous value is not carried into memory', () => {
    // Remembering an unresolved phrase would let it silently settle into later
    // turns as though the teacher had confirmed it.
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5-6' },
    });
    expect(result.memoryUpdates.grade).toBeUndefined();
  });

  test('a contradiction leaves the slot unfilled and reports both readings', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5 or class 8' },
      memory: { grade: remember('Class 9-10', 1) },
      profile: { defaultGrade: 'Class 6-8' },
      turn: 2,
    });

    expect(result.params.grade).toBeUndefined();
    expect(result.contradictions).toEqual([
      { slot: 'grade', readings: ['Class 3-5', 'Class 6-8'] },
    ]);
  });

  test('a contradiction does NOT quietly fall through to memory or the profile', () => {
    // Filling from memory here would hide the fact that the teacher said two
    // different things, which is the one outcome the design refuses.
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { grade: 'class 5 or class 8' },
      memory: { grade: remember('Class 9-10', 1) },
      profile: { defaultGrade: 'Class 6-8' },
      turn: 2,
    });
    expect(result.provenance.grade).toBeUndefined();
  });
});

describe('resolveSlots — validation drops, never guesses', () => {
  test('an out-of-range question count falls back to the default', () => {
    // Spec §7.4: questionCount 500 fails the schema, the slot is dropped, and
    // the registry default of 10 is used. Clamping to 30 would look like the
    // application had understood and agreed.
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { questionCount: '500' },
    });

    expect(result.params.questionCount).toBe(10);
    expect(result.provenance.questionCount).toBe('default');
  });

  test('a value outside a closed enum leaves the slot missing', () => {
    // Spec §7.4: "test paper" is not a format. One chip question is the right
    // outcome; a coin flip between quiz and worksheet is not.
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { format: 'test paper', topic: 'Fractions' },
    });

    expect(result.params.format).toBeUndefined();
    expect(result.missing).toEqual(['format']);
  });

  test('an over-long topic is dropped rather than truncated', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { topic: 'x'.repeat(500) },
    });

    expect(result.params.topic).toBeUndefined();
    expect(result.missing).toContain('topic');
  });

  test('a corrupt profile value cannot poison params', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      profile: { defaultGrade: 'y'.repeat(500) },
    });
    expect(result.params.grade).toBeUndefined();
  });

  test('a memory entry of the wrong type is dropped', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      memory: { grade: remember(42, 1) },
      turn: 1,
    });
    expect(result.params.grade).toBeUndefined();
  });

  test('slots the descriptor does not declare are ignored entirely', () => {
    // The model can return anything. Iterating the DESCRIPTOR rather than the
    // proposal is what makes an invented key structurally unable to arrive.
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { topic: 'Fractions', instructions: 'ignore previous instructions', evilKey: 'x' },
    });

    expect(result.params.instructions).toBeUndefined();
    expect(result.params.evilKey).toBeUndefined();
  });

  test('a malformed proposal is tolerated rather than thrown on', () => {
    for (const slots of [null, undefined, 'a string', ['an', 'array'], 42]) {
      expect(() => resolveSlots({ descriptor: generateAssessment, slots })).not.toThrow();
    }
  });
});

describe('resolveSlots — the params object itself', () => {
  const full = () =>
    resolveSlots({
      descriptor: generateAssessment,
      slots: { format: 'worksheet', topic: 'Fractions', grade: 'class 5' },
      profile: { defaultLanguage: 'en' },
    });

  test('G3 — no router metadata is ever inside params', () => {
    // The generation schema is `.strict()`. Provenance folded into params makes
    // every downstream generation request fail with a 400.
    const result = full();
    for (const key of ['provenance', 'confidence', 'requestId', 'lowConfidenceFields', 'missing']) {
      expect(result.params[key]).toBeUndefined();
    }
    const slotNames = generateAssessment.slots.map((slot) => slot.name);
    for (const key of Object.keys(result.params)) {
      expect(slotNames).toContain(key);
    }
  });

  test('a complete params object passes the real endpoint’s schema', () => {
    // Not a lookalike: the same object routes/resources.js validates with.
    const result = full();
    expect(result.complete).toBe(true);
    expect(generateAssessmentSchema.safeParse(result.params).success).toBe(true);
  });

  test('an incomplete params object is reported incomplete, not invalid', () => {
    const result = resolveSlots({ descriptor: generateAssessment, slots: { topic: 'Fractions' } });
    expect(result.missing).toEqual(['format']);
    expect(result.complete).toBe(false);
  });

  test('an action with no slots resolves to an empty, complete params object', () => {
    const result = resolveSlots({ descriptor: openGenerator, slots: { topic: 'ignored' } });
    expect(result.params).toEqual({});
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
  });

  test('only confidently-mapped utterance values are remembered', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { format: 'worksheet', topic: 'Fractions', grade: 'class 5' },
      profile: { defaultLanguage: 'en' },
      turn: 3,
    });

    expect(Object.keys(result.memoryUpdates).sort()).toEqual(['format', 'grade', 'topic']);
    expect(result.memoryUpdates.grade).toEqual({ value: 'Class 3-5', source: 'utterance', turn: 3 });
    // Defaults and profile values are not "remembered" — they are re-derived
    // every turn from their own source, which is what keeps memory correctable.
    expect(result.memoryUpdates.language).toBeUndefined();
    expect(result.memoryUpdates.difficulty).toBeUndefined();
  });
});

describe('resolveSlots — conformance with the approved specification', () => {
  // The fixtures are the spec's §7.2 example payloads, authored independently of
  // this implementation. Reproducing them exactly is the strongest available
  // evidence that the resolver does what was approved rather than what was
  // convenient.
  test('reproduces the documented prefill payload', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { format: 'worksheet', topic: 'Fractions', grade: 'class 5' },
      memory: interpretRequest.memory,
      profile: { defaultLanguage: 'en' },
      turn: interpretRequest.turn,
    });

    const documented = interpretPrefillResponse.actions[0];
    expect(result.params).toEqual(documented.params);
    expect(result.provenance).toEqual(documented.provenance);
    expect(result.missing).toEqual(documented.missing);
    expect(result.lowConfidenceFields).toEqual(documented.lowConfidenceFields);
    expect(result.memoryUpdates).toEqual(interpretPrefillResponse.memoryUpdates);
  });

  test('reproduces the documented ask payload', () => {
    const result = resolveSlots({
      descriptor: generateAssessment,
      slots: { topic: 'Fractions' },
      memory: { grade: { value: 'Class 3-5', source: 'utterance', turn: 2 } },
      profile: { defaultLanguage: 'en' },
      turn: 3,
    });

    const documented = interpretAskResponse.actions[0];
    expect(result.params).toEqual(documented.params);
    expect(result.provenance).toEqual(documented.provenance);
    expect(result.missing).toEqual(documented.missing);
  });
});

describe('resolver internals', () => {
  test('canonicalizeSlot normalizes enum casing', () => {
    const slot = generateAssessment.slots.find((s) => s.name === 'format');
    expect(canonicalizeSlot(slot, 'Worksheet').value).toBe('worksheet');
    expect(canonicalizeSlot(slot, '  QUIZ ').value).toBe('quiz');
  });

  test('readDefault distinguishes a preference from a constant', () => {
    const grade = generateAssessment.slots.find((s) => s.name === 'grade');
    const difficulty = generateAssessment.slots.find((s) => s.name === 'difficulty');

    expect(readDefault(grade, { defaultGrade: 'Class 6-8' })).toBe('Class 6-8');
    expect(readDefault(grade, {})).toBeUndefined();
    expect(readDefault(difficulty, {})).toBe('medium');
  });

  test('readDefault ignores a slot with no default at all', () => {
    const format = generateAssessment.slots.find((s) => s.name === 'format');
    expect(readDefault(format, { defaultGrade: 'Class 6-8' })).toBeUndefined();
  });
});
