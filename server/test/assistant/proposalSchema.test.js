// The untrusted-model boundary (Milestone M5).
//
// Everything here is about ONE question: what can a model response make the
// application do? The answer must be "nothing it was not explicitly asked for",
// and the tests below try to break that from every angle a real model failure
// (or a real attack) would take — wrong shape, wrong types, extra fields,
// fabricated action ids, slots for an action that does not declare them.
//
// The most important test in this file is the last group: the response schema is
// DERIVED FROM THE REGISTRY, so adding an action widens the accepted intent set
// with no edit here. A hand-maintained enum would be a second list to forget.

const { CONFIDENCE_LEVELS, NON_ACTION_INTENTS } = require('../../src/assistant/contracts');
const { DESCRIPTORS } = require('../../src/actions/registry');
const { generateAssessment } = require('../../src/actions/descriptors/generateAssessment');
const { openGenerator } = require('../../src/actions/descriptors/openGenerator');
const {
  MAX_SLOT_VALUE_LENGTH,
  MAX_ALTERNATIVES,
  allowedIntents,
  allowedSlotNames,
  buildResponseSchema,
  buildProposalSchema,
  sanitizeSlots,
  computeMargin,
  parseProposal,
} = require('../../src/assistant/proposalSchema');

/** The realistic case: every Phase 1 action visible to the caller. */
const BOTH = [generateAssessment, openGenerator];

/** A well-formed proposal, so each test can vary exactly one thing. */
const validProposal = (overrides = {}) => ({
  intent: 'generate_assessment',
  confidence: 'high',
  slots: { format: 'worksheet', topic: 'fractions' },
  ...overrides,
});

describe('the accepted intent set', () => {
  test('is every visible action id plus the non-action intents', () => {
    expect(allowedIntents(BOTH)).toEqual([
      'generate_assessment',
      'open_generator',
      'unknown',
      'coach_question',
    ]);
  });

  test('shrinks with the role-filtered catalog', () => {
    // A caller who may only open the generator must not be offered an intent
    // enum that includes generating one.
    expect(allowedIntents([openGenerator])).toEqual(['open_generator', 'unknown', 'coach_question']);
  });

  test('still permits the non-action intents when NO action is visible', () => {
    // Everything flagged off must not make "this is a coaching question"
    // unrepresentable — that is the answer the router wants most often.
    expect(allowedIntents([])).toEqual([...NON_ACTION_INTENTS]);
  });
});

describe('the Gemini response schema', () => {
  const schema = buildResponseSchema(BOTH);

  test('asks for exactly four fields and nothing else', () => {
    // This is the output contract. A field added here is a new thing the model
    // is allowed to invent, so the list is asserted literally rather than by
    // spot-checking a few keys.
    expect(Object.keys(schema.properties).sort()).toEqual([
      'alternatives',
      'confidence',
      'intent',
      'slots',
    ]);
  });

  test('has no field for a decision, a route, params, or a rationale', () => {
    const forbidden = [
      'decision', 'route', 'url', 'path', 'params', 'parameters',
      'provenance', 'reasoning', 'reason', 'explanation', 'rationale', 'thoughts',
    ];
    for (const key of forbidden) {
      expect(schema.properties).not.toHaveProperty(key);
    }
  });

  test('requires only intent and confidence', () => {
    // Slots are genuinely optional: "open the generator" fills nothing, and a
    // schema that demanded them would push the model into inventing values.
    expect(schema.required).toEqual(['intent', 'confidence']);
  });

  test('constrains confidence to the frozen ordinal levels', () => {
    expect(schema.properties.confidence.enum).toEqual([...CONFIDENCE_LEVELS]);
  });

  test('declares every slot as a STRING, including the numeric one', () => {
    // questionCount is an integer in the generation schema. The model still
    // reports raw text ("ten questions"); turning that into a bounded integer
    // is the resolver's job. A NUMBER here would invite the model to do the
    // application's canonicalization for it.
    const slots = schema.properties.slots.properties;
    expect(slots.questionCount).toEqual({ type: 'STRING' });
    for (const spec of Object.values(slots)) expect(spec.type).toBe('STRING');
  });

  test('offers exactly the union of the visible actions’ slots', () => {
    expect(Object.keys(schema.properties.slots.properties).sort()).toEqual(
      allowedSlotNames(BOTH).sort()
    );
    // open_generator declares none, so the union is generate_assessment's set.
    expect(allowedSlotNames([openGenerator])).toEqual([]);
  });
});

describe('proposal validation — SHAPE ONLY, by design', () => {
  const schema = buildProposalSchema();

  test('accepts a well-formed proposal', () => {
    expect(schema.safeParse(validProposal()).success).toBe(true);
  });

  test('does NOT judge catalog membership — that is gate 2b’s job', () => {
    // Deliberate. An earlier draft put the catalog enum here as well as in
    // parseProposal, which made the authorization check unreachable dead code:
    // zod always rejected a bad id first, so injecting a defect into the real
    // guard changed nothing and 123 tests still passed. Splitting shape from
    // permission is what gives G4 teeth. See the module comment.
    expect(schema.safeParse(validProposal({ intent: 'delete_all_resources' })).success).toBe(true);
  });

  test('still rejects an intent that is not a plausible id at all', () => {
    for (const intent of ['', '   ', 'x'.repeat(61), 42, null, {}, []]) {
      expect(schema.safeParse(validProposal({ intent })).success).toBe(false);
    }
  });

  test('rejects a float confidence', () => {
    // Decision D9: ordinal, never a float. A model returning 0.87 is not
    // "mostly right about the shape" — it is unusable, because nothing in the
    // policy knows what 0.87 means.
    expect(schema.safeParse(validProposal({ confidence: 0.87 })).success).toBe(false);
    expect(schema.safeParse(validProposal({ confidence: 'very high' })).success).toBe(false);
  });

  test('rejects a missing intent or confidence', () => {
    const { intent: _i, ...noIntent } = validProposal();
    const { confidence: _c, ...noConfidence } = validProposal();
    expect(schema.safeParse(noIntent).success).toBe(false);
    expect(schema.safeParse(noConfidence).success).toBe(false);
  });

  test('REJECTS an unexpected top-level key, rather than stripping it', () => {
    // The cost is real: a model that helpfully adds `reasoning` loses its whole
    // proposal and the teacher gets a coaching answer. That is the intended
    // trade. Silently stripping would let the output contract erode with nobody
    // noticing, and a visible logged failure is the entire defence against a
    // model doing more than it was asked.
    for (const extra of [{ reasoning: 'because' }, { decision: 'execute' }, { route: '/generator' }]) {
      expect(schema.safeParse(validProposal(extra)).success).toBe(false);
    }
  });

  test('caps alternatives at two', () => {
    // Alternatives feed the margin signal and nothing else. An unbounded list
    // is a way to make the server do unbounded work on model-controlled input.
    const alt = (intent) => ({ intent, confidence: 'medium' });
    expect(schema.safeParse(validProposal({ alternatives: [alt('open_generator')] })).success).toBe(true);
    expect(
      schema.safeParse(
        validProposal({ alternatives: Array(MAX_ALTERNATIVES + 1).fill(alt('open_generator')) })
      ).success
    ).toBe(false);
  });

  test('rejects a malformed alternative', () => {
    expect(schema.safeParse(validProposal({ alternatives: [{ intent: 'x' }] })).success).toBe(false);
    expect(schema.safeParse(validProposal({ alternatives: ['open_generator'] })).success).toBe(false);
  });

  test('accepts a proposal with no slots at all', () => {
    const { slots: _s, ...bare } = validProposal({ intent: 'open_generator' });
    expect(schema.safeParse(bare).success).toBe(true);
  });
});

describe('slot sanitization — drop the offender, keep the rest', () => {
  test('keeps slots the descriptor declares', () => {
    const { slots, dropped } = sanitizeSlots(generateAssessment, {
      format: 'worksheet',
      topic: 'fractions',
    });
    expect(slots).toEqual({ format: 'worksheet', topic: 'fractions' });
    expect(dropped).toBe(0);
  });

  test('drops a slot the descriptor does not declare, keeping the others', () => {
    // The asymmetry with the top-level `.strict()` above is deliberate: an
    // unexpected top-level key means the model ignored the contract, while an
    // unexpected slot is ordinary noisy extraction.
    const { slots, dropped } = sanitizeSlots(generateAssessment, {
      topic: 'fractions',
      instructions: 'make it fun',
      schoolId: 'abc123',
    });
    expect(slots).toEqual({ topic: 'fractions' });
    expect(dropped).toBe(2);
  });

  test('drops every slot for an action that declares none', () => {
    const { slots, dropped } = sanitizeSlots(openGenerator, { topic: 'fractions' });
    expect(slots).toEqual({});
    expect(dropped).toBe(1);
  });

  test('drops non-string, empty and oversized values', () => {
    const { slots, dropped } = sanitizeSlots(generateAssessment, {
      topic: 'fractions',
      grade: 5,
      subject: '   ',
      difficulty: null,
      language: 'x'.repeat(MAX_SLOT_VALUE_LENGTH + 1),
    });
    expect(slots).toEqual({ topic: 'fractions' });
    expect(dropped).toBe(4);
  });

  test('survives a hostile or absent slot bag without throwing', () => {
    for (const hostile of [undefined, null, 'a string', 42, ['an', 'array']]) {
      expect(() => sanitizeSlots(generateAssessment, hostile)).not.toThrow();
      expect(sanitizeSlots(generateAssessment, hostile).slots).toEqual({});
    }
  });
});

describe('margin — derived, never asked for', () => {
  test('is close when a rival claims the same confidence', () => {
    const alternatives = [{ intent: 'open_generator', confidence: 'medium' }];
    expect(computeMargin(alternatives, 'medium', 'generate_assessment')).toBe('close');
  });

  test('is clear when the rival is less confident', () => {
    const alternatives = [{ intent: 'open_generator', confidence: 'low' }];
    expect(computeMargin(alternatives, 'high', 'generate_assessment')).toBe('clear');
  });

  test('is clear when the model echoes the chosen intent as its own alternative', () => {
    const alternatives = [{ intent: 'generate_assessment', confidence: 'high' }];
    expect(computeMargin(alternatives, 'high', 'generate_assessment')).toBe('clear');
  });

  test('is clear when there are no alternatives', () => {
    expect(computeMargin(undefined, 'high', 'generate_assessment')).toBe('clear');
    expect(computeMargin([], 'high', 'generate_assessment')).toBe('clear');
  });
});

describe('parseProposal — validation then AUTHORIZATION', () => {
  test('returns the descriptor for a legitimate proposal', () => {
    const result = parseProposal(validProposal(), BOTH);
    expect(result.ok).toBe(true);
    expect(result.proposal.descriptor).toBe(generateAssessment);
    expect(result.proposal.slots).toEqual({ format: 'worksheet', topic: 'fractions' });
    expect(result.proposal.margin).toBe('clear');
  });

  test('reports a non-action intent with a null descriptor', () => {
    for (const intent of NON_ACTION_INTENTS) {
      const result = parseProposal({ intent, confidence: 'high' }, BOTH);
      expect(result.ok).toBe(true);
      expect(result.proposal.descriptor).toBeNull();
      expect(result.proposal.intent).toBe(intent);
    }
  });

  test('G4 — a fabricated action id yields invalid_proposal, never a descriptor', () => {
    const result = parseProposal(
      { intent: 'delete_all_resources', confidence: 'high' },
      BOTH
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_proposal' });
  });

  test('G4 — an action the CALLER may not use is refused even though it exists', () => {
    // The heart of the guardrail. `generate_assessment` is a real, valid,
    // registered action — but it was not in the catalog this request was built
    // from, so proposing it is an authorization failure, not a typo.
    const result = parseProposal(validProposal(), [openGenerator]);
    expect(result).toEqual({ ok: false, reason: 'invalid_proposal' });
  });

  test('G4 — the refusal NEVER falls back to another descriptor', () => {
    // Written specifically to catch the most plausible way this guard gets
    // broken: someone adds a `|| descriptors[0]` fallback so an unrecognised id
    // "still does something useful". That single change would let any string the
    // model emits execute the first action in the catalog.
    //
    // This assertion is the injected-defect proof for G4. Adding such a fallback
    // must fail it — and when the catalog enum lived in the zod schema, it did
    // NOT, because zod rejected the id first and this branch never ran.
    for (const list of [BOTH, [openGenerator], [generateAssessment]]) {
      const result = parseProposal({ intent: 'delete_all_resources', confidence: 'high' }, list);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('proposal');
    }
  });

  test('G4 — an id differing only in case is refused', () => {
    // Ids are matched exactly. Case-folding would be a way to smuggle an
    // unauthorized action past an exact-match allow-list somewhere else.
    for (const intent of ['Generate_Assessment', 'GENERATE_ASSESSMENT', 'generate-assessment']) {
      expect(parseProposal({ intent, confidence: 'high' }, BOTH).ok).toBe(false);
    }
  });

  test('surrounding whitespace on an otherwise valid id is tolerated', () => {
    // Trimmed, then matched exactly. Safe because the comparison after
    // normalization is still against the caller's own catalog — being lenient
    // about a stray space costs nothing and avoids losing a good routing to a
    // model's formatting quirk.
    const result = parseProposal({ intent: '  generate_assessment  ', confidence: 'high' }, BOTH);
    expect(result.ok).toBe(true);
    expect(result.proposal.descriptor).toBe(generateAssessment);
  });

  test('refuses every action when the visible catalog is empty', () => {
    expect(parseProposal(validProposal(), []).ok).toBe(false);
    // ...but a coaching question is still expressible.
    expect(parseProposal({ intent: 'coach_question', confidence: 'high' }, []).ok).toBe(true);
  });

  test('never throws on hostile input', () => {
    for (const hostile of [null, undefined, 'text', 42, [], { intent: {} }, { intent: 'x'.repeat(5000) }]) {
      expect(() => parseProposal(hostile, BOTH)).not.toThrow();
      expect(parseProposal(hostile, BOTH).ok).toBe(false);
    }
  });
});

describe('REGRESSION — the response schema is derived entirely from the registry', () => {
  // Required at M5 sign-off. The property under test is that adding an action to
  // the registry automatically widens what the classifier accepts, with no edit
  // to proposalSchema.js. If someone ever replaces the derivation with a
  // hand-written enum, these fail — which is the whole point, because a
  // hand-written enum is a second source of truth that drifts the first time an
  // action is added under time pressure.

  /** A plausible Phase 2 action, registered nowhere. */
  const futureAction = {
    ...openGenerator,
    id: 'search_library',
    summary: 'Find a saved resource in the library.',
    slots: [{ name: 'query', type: 'text', required: true, ask: 'What are you looking for?' }],
  };

  test('a newly registered action becomes an accepted intent with no code change', () => {
    expect(allowedIntents(BOTH)).not.toContain('search_library');

    const widened = [...BOTH, futureAction];
    expect(allowedIntents(widened)).toContain('search_library');
    expect(buildResponseSchema(widened).properties.intent.enum).toContain('search_library');
    // Asserted through parseProposal, which is where authorization actually
    // happens — buildProposalSchema validates shape only and would accept the
    // id regardless, so asserting against it would prove nothing.
    expect(parseProposal({ intent: 'search_library', confidence: 'high' }, widened).ok).toBe(true);
    expect(parseProposal({ intent: 'search_library', confidence: 'high' }, BOTH).ok).toBe(false);
  });

  test('a newly registered action’s slots become extractable with no code change', () => {
    const widened = [...BOTH, futureAction];
    expect(buildResponseSchema(widened).properties.slots.properties).toHaveProperty('query');
    expect(parseProposal({ intent: 'search_library', confidence: 'high', slots: { query: 'fractions' } }, widened)
      .proposal.slots).toEqual({ query: 'fractions' });
  });

  test('the intent enum tracks the live registry, not a copy of it', () => {
    // Asserted against DESCRIPTORS itself so that registering a third action in
    // M-whatever cannot leave this file behind.
    const live = buildResponseSchema(DESCRIPTORS).properties.intent.enum;
    for (const descriptor of DESCRIPTORS) expect(live).toContain(descriptor.id);
    expect(live).toHaveLength(DESCRIPTORS.length + NON_ACTION_INTENTS.length);
  });

  test('removing an action from the visible set removes it from the schema', () => {
    // Drift in the other direction: a deprecated or flag-disabled action must
    // stop being proposable the moment it stops being visible.
    const enums = buildResponseSchema([generateAssessment]).properties.intent.enum;
    expect(enums).toContain('generate_assessment');
    expect(enums).not.toContain('open_generator');
  });
});
