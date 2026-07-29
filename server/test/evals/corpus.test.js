// Corpus integrity (Milestone M7a).
//
// The corpus is DATA, and unvalidated data is how an evaluation harness ends up
// measuring nothing. These tests are the control that keeps the labels honest:
// they check the corpus against the REGISTRY and against the real safety guard,
// so a label cannot claim something the application could never produce.
//
// The load itself is the first assertion — loadCorpus throws on a missing
// directory, a malformed line, a duplicate id, a duplicate utterance and an
// empty stratum.


const { loadCorpus, STRATUM_MINIMUMS } = require('../../evals/lib/loadCorpus');
const { caseSchema } = require('../../evals/lib/caseSchema');
const { listForRole } = require('../../src/actions/registry');
const { detectEmergency, normalizeQuery } = require('../../src/safety/inputGuard');

const RUN_ENV = {
  ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
  ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
};

const corpus = loadCorpus();
const descriptors = listForRole('teacher', RUN_ENV);
const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

/** Every labelled turn in the corpus, single and multi-turn alike. */
const allTurns = [
  ...corpus.cases.map((entry) => ({ id: entry.id, turn: null, ...entry })),
  ...corpus.sessions.flatMap((session) =>
    session.turns.map((turn, index) => ({
      id: `${session.id}#${index + 1}`,
      turn: index + 1,
      stratum: 'memory',
      language: session.language,
      utterance: turn.utterance,
      expected: turn.expected,
    }))
  ),
];

describe('corpus integrity', () => {
  test('loads a non-empty corpus with every stratum above its floor', () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
    expect(corpus.sessions.length).toBeGreaterThan(0);
    for (const [stratum, minimum] of Object.entries(STRATUM_MINIMUMS)) {
      expect(corpus.counts[stratum]).toBeGreaterThanOrEqual(minimum);
    }
  });

  test('meets the specification\'s >=120 labelled utterance requirement', () => {
    expect(allTurns.length).toBeGreaterThanOrEqual(120);
  });

  test('every expected actionId is a real, visible capability', () => {
    for (const turn of allTurns) {
      if (turn.expected.actionId === null) continue;
      expect(byId.has(turn.expected.actionId), `${turn.id} names ${turn.expected.actionId}`).toBe(true);
    }
  });

  test('every slot named in a label is a real slot on that action', () => {
    for (const turn of allTurns) {
      const descriptor = byId.get(turn.expected.actionId);
      if (!descriptor) continue;
      const slotNames = new Set(descriptor.slots.map((slot) => slot.name));
      const spec = turn.expected.slots;
      const named = [
        ...Object.keys(spec.stated),
        ...Object.keys(spec.inherited),
        ...spec.notStated,
        ...spec.mustNotInherit,
      ];
      for (const slot of named) {
        expect(slotNames.has(slot), `${turn.id} names slot "${slot}"`).toBe(true);
      }
    }
  });

  test('every stated value would be accepted by the action\'s own schema', () => {
    for (const turn of allTurns) {
      const descriptor = byId.get(turn.expected.actionId);
      if (!descriptor) continue;
      for (const [slot, value] of Object.entries(turn.expected.slots.stated)) {
        const field = descriptor.paramSchema.shape[slot];
        expect(field, `${turn.id}: schema has no field "${slot}"`).toBeDefined();
        expect(
          field.safeParse(value).success,
          `${turn.id}: ${slot}=${JSON.stringify(value)} would be rejected by the real schema`
        ).toBe(true);
      }
    }
  });

  test('stated and notStated never overlap', () => {
    for (const turn of allTurns) {
      const stated = new Set(Object.keys(turn.expected.slots.stated));
      for (const slot of turn.expected.slots.notStated) {
        expect(stated.has(slot), `${turn.id}: "${slot}" is both stated and notStated`).toBe(false);
      }
    }
  });

  test('every askSlot is required and actually has an ask string', () => {
    for (const turn of allTurns) {
      if (turn.expected.decision !== 'ask') continue;
      const descriptor = byId.get(turn.expected.actionId);
      expect(descriptor, `${turn.id} expects an ask but names no action`).toBeDefined();
      const slot = descriptor.slots.find((candidate) => candidate.name === turn.expected.askSlot);
      expect(slot, `${turn.id}: no slot named "${turn.expected.askSlot}"`).toBeDefined();
      expect(slot.required).toBe(true);
      expect(typeof slot.ask).toBe('string');
      expect(slot.ask.length).toBeGreaterThan(0);
    }
  });

  // The bidirectional form of this check matters more than the forward one.
  // Asserting only that emergency-labelled cases trip the guard would let the
  // three non-English cases silently claim a short-circuit they do not get.
  test('emergency labels match what the real guard actually detects, both ways', () => {
    for (const turn of allTurns) {
      const detected = detectEmergency(normalizeQuery(turn.utterance)).isEmergency;
      const claimed = turn.expected.passthroughReason === 'emergency_detected';
      expect(
        detected,
        `${turn.id}: label claims emergency_detected=${claimed} but detectEmergency says ${detected}`
      ).toBe(claimed);
    }
  });

  test('every emergency-stratum case expects passthrough, guard or no guard', () => {
    const emergencies = corpus.cases.filter((entry) => entry.stratum === 'emergency');
    expect(emergencies.length).toBeGreaterThanOrEqual(STRATUM_MINIMUMS.emergency);
    for (const entry of emergencies) {
      expect(entry.expected.decision, entry.id).toBe('passthrough');
      expect(entry.expected.actionId, entry.id).toBeNull();
    }
  });

  test('only ambiguous cases carry an acceptable set', () => {
    for (const turn of allTurns) {
      const hasAcceptable = Array.isArray(turn.expected.acceptable);
      expect(hasAcceptable, `${turn.id}`).toBe(turn.stratum === 'ambiguous');
      if (hasAcceptable) {
        expect(turn.expected.acceptable).toContain(turn.expected.decision);
      }
    }
  });

  test('Devanagari and Hinglish strata really are what they claim', () => {
    const devanagari = /[ऀ-ॿ]/;
    for (const turn of allTurns) {
      if (turn.stratum === 'memory') continue;
      if (turn.language === 'hi') {
        expect(devanagari.test(turn.utterance), `${turn.id} is labelled hi`).toBe(true);
      }
      if (turn.language === 'hinglish') {
        expect(devanagari.test(turn.utterance), `${turn.id} is labelled hinglish`).toBe(false);
      }
    }
  });

  test('every Devanagari command that names no language lists language as notStated', () => {
    // The language trap is only measurable where the label says the teacher did
    // not name a language. A hi-stratum case missing that entry would silently
    // opt out of the hard gate.
    for (const entry of corpus.cases) {
      if (entry.language !== 'hi' || entry.stratum !== 'commands') continue;
      if ('language' in entry.expected.slots.stated) continue;
      if (entry.expected.actionId !== 'generate_assessment') continue;
      expect(entry.expected.slots.notStated, entry.id).toContain('language');
    }
  });

  test('a malformed case is rejected rather than coerced', () => {
    expect(caseSchema.safeParse({ id: 'x.1', stratum: 'commands' }).success).toBe(false);
    expect(
      caseSchema.safeParse({
        id: 'x.1',
        stratum: 'not-a-stratum',
        language: 'en',
        utterance: 'hi',
        expected: { decision: 'prefill', actionId: null },
      }).success
    ).toBe(false);
    // An unknown key is rejected, not silently dropped: a typo'd label field
    // would otherwise mean an assertion nobody notices is missing.
    expect(
      caseSchema.safeParse({
        id: 'x.1',
        stratum: 'commands',
        language: 'en',
        utterance: 'hi',
        expected: { decision: 'prefill', actionId: null },
        typoField: true,
      }).success
    ).toBe(false);
  });
});
