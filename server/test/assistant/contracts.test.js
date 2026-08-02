// Milestone M0 — the contract freeze, made executable.
//
// These tests exist so that "frozen" means something enforceable rather than a
// promise in a document. Two things are checked:
//
//   1. The vocabularies themselves hold their Phase 1 shape (the effect ceiling,
//      the decision subset, immutability).
//   2. The example payloads published in docs/ai-action-router-phase1-spec.md §7
//      — kept executable in test/helpers/assistantFixtures.js — actually conform
//      to those vocabularies. A documented example that no longer validates is
//      the usual way a spec quietly stops being true.
//
// Several assertions here encode guardrails that no implementation exists to
// violate yet (the strict-params rule, the effect ceiling). That is deliberate:
// the cheapest moment to make a rule executable is before the code that could
// break it is written.

const contracts = require('../../src/assistant/contracts');
const fixtures = require('../helpers/assistantFixtures');

const {
  ASSISTANT_CONTRACT_VERSION,
  MAX_UTTERANCE_LENGTH,
  EFFECTS,
  PHASE1_MAX_EFFECT,
  DECISIONS,
  PHASE1_DECISIONS,
  PASSTHROUGH_REASONS,
  PROVENANCE_SOURCES,
  CONFIDENCE_LEVELS,
  ACTION_STATUSES,
  SLOT_TYPES,
  VOCABULARIES,
  NON_ACTION_INTENTS,
} = contracts;

/** Router metadata that must never appear INSIDE a params object (see guardrail G3). */
const METADATA_KEYS = ['provenance', 'confidence', 'decision', 'effect', 'requestId', 'actionId', 'missing'];

const ALL_VOCABULARIES = [
  ['EFFECTS', EFFECTS],
  ['DECISIONS', DECISIONS],
  ['PHASE1_DECISIONS', PHASE1_DECISIONS],
  ['PASSTHROUGH_REASONS', PASSTHROUGH_REASONS],
  ['PROVENANCE_SOURCES', PROVENANCE_SOURCES],
  ['CONFIDENCE_LEVELS', CONFIDENCE_LEVELS],
  ['ACTION_STATUSES', ACTION_STATUSES],
  ['SLOT_TYPES', SLOT_TYPES],
  ['VOCABULARIES', VOCABULARIES],
  ['NON_ACTION_INTENTS', NON_ACTION_INTENTS],
];

describe('assistant contracts — frozen vocabularies', () => {
  test('every exported vocabulary is immutable and non-empty', () => {
    for (const [name, vocabulary] of ALL_VOCABULARIES) {
      expect(Array.isArray(vocabulary), `${name} should be an array`).toBe(true);
      expect(vocabulary.length, `${name} should not be empty`).toBeGreaterThan(0);
      expect(Object.isFrozen(vocabulary), `${name} should be frozen`).toBe(true);
      // Duplicates would make membership checks pass while signalling a merge
      // mistake in the vocabulary itself.
      expect(new Set(vocabulary).size, `${name} should have no duplicates`).toBe(vocabulary.length);
    }
  });

  test('the contract version and utterance cap are the agreed values', () => {
    expect(ASSISTANT_CONTRACT_VERSION).toBe(1);
    // Must match MAX_QUERY_LENGTH in src/index.js: the router shares the coach's
    // composer, so anything the coach accepts the router must accept too.
    expect(MAX_UTTERANCE_LENGTH).toBe(500);
  });

  test('effects are ordered from least to most consequential', () => {
    // The policy caps decisions by effect, so the ORDER is load-bearing, not
    // just the membership.
    expect(EFFECTS).toEqual(['read', 'draft', 'write', 'destructive']);
  });

  test('Phase 1 allows nothing above "draft"', () => {
    expect(PHASE1_MAX_EFFECT).toBe('draft');
    expect(EFFECTS).toContain(PHASE1_MAX_EFFECT);
    // Anything at or below the ceiling is permitted; write/destructive are not.
    const ceiling = EFFECTS.indexOf(PHASE1_MAX_EFFECT);
    expect(EFFECTS.indexOf('write')).toBeGreaterThan(ceiling);
    expect(EFFECTS.indexOf('destructive')).toBeGreaterThan(ceiling);
  });

  test('Phase 1 decisions are a strict subset that excludes execute and suggest', () => {
    for (const decision of PHASE1_DECISIONS) {
      expect(DECISIONS).toContain(decision);
    }
    // 'execute' stays defined so the client can defensively downgrade it;
    // 'suggest' stays defined so Phase 2 is additive rather than breaking.
    // Neither may ever be emitted in Phase 1.
    expect(PHASE1_DECISIONS).not.toContain('execute');
    expect(PHASE1_DECISIONS).not.toContain('suggest');
    expect(PHASE1_DECISIONS).toEqual(['prefill', 'ask', 'passthrough']);
  });

  test('non-action intents do not collide with real action ids', () => {
    // 'unknown' and 'coach_question' are reserved: an action may never claim
    // either as its id, or a correct "no action here" answer would be
    // indistinguishable from a real routing.
    expect(NON_ACTION_INTENTS).toEqual(['unknown', 'coach_question']);
  });
});

describe('assistant contracts — documented catalog example', () => {
  const { actions } = fixtures.catalogResponse;

  test('the disabled catalog is a valid inert state, not an error', () => {
    expect(fixtures.catalogDisabledResponse.catalogVersion).toBe(0);
    expect(fixtures.catalogDisabledResponse.actions).toEqual([]);
  });

  test('every catalog action uses only frozen vocabulary values', () => {
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(ACTION_STATUSES, action.id).toContain(action.status);
      expect(EFFECTS, action.id).toContain(action.effect);
      expect(typeof action.version).toBe('number');
      expect(typeof action.summary).toBe('string');
      expect(action.summary.length).toBeGreaterThan(0);
    }
  });

  test('no catalog action exceeds the Phase 1 effect ceiling', () => {
    const ceiling = EFFECTS.indexOf(PHASE1_MAX_EFFECT);
    for (const action of actions) {
      expect(EFFECTS.indexOf(action.effect), `${action.id} effect "${action.effect}"`).toBeLessThanOrEqual(ceiling);
    }
  });

  test('server-internal descriptor fields are never projected into the catalog', () => {
    // The client is told what it may use, never what it may not. Leaking
    // requiredRoles would hand an attacker the permission map; leaking
    // paramSchema would invite the client to re-implement validation.
    for (const action of actions) {
      expect(action).not.toHaveProperty('paramSchema');
      expect(action).not.toHaveProperty('requiredRoles');
      expect(action).not.toHaveProperty('featureFlag');
      expect(action).not.toHaveProperty('autoExecute');
      // No route, path or URL either — the server never tells the client where
      // to navigate.
      expect(action).not.toHaveProperty('route');
      expect(action).not.toHaveProperty('path');
      expect(action).not.toHaveProperty('url');
    }
  });

  test('every action carries enough examples to seed the prompt, chips and evals', () => {
    for (const action of actions) {
      expect(Array.isArray(action.examples), action.id).toBe(true);
      expect(action.examples.length, `${action.id} needs >=5 examples`).toBeGreaterThanOrEqual(5);
    }
  });

  test('slot definitions are internally consistent', () => {
    for (const action of actions) {
      for (const slot of action.slots) {
        expect(SLOT_TYPES, `${action.id}.${slot.name}`).toContain(slot.type);
        expect(typeof slot.required).toBe('boolean');

        if (slot.type === 'enum') {
          expect(Array.isArray(slot.values), `${slot.name} enum needs values`).toBe(true);
          expect(slot.values.length).toBeGreaterThan(1);
        }
        if (slot.type === 'vocab') {
          expect(VOCABULARIES, `${slot.name} vocab`).toContain(slot.vocab);
        }
        if (slot.type === 'number') {
          expect(typeof slot.min).toBe('number');
          expect(typeof slot.max).toBe('number');
          expect(slot.max).toBeGreaterThan(slot.min);
        }
        // A required slot must be answerable: the policy asks about exactly one
        // missing required slot, and it needs a question to ask.
        if (slot.required) {
          expect(typeof slot.ask, `${slot.name} is required so it needs an "ask"`).toBe('string');
          expect(slot.ask.length).toBeGreaterThan(0);
        }
        // Chip options must be a closed set — free-text answers take the
        // re-interpretation path instead.
        if (slot.askOptions) {
          expect(slot.type).toBe('enum');
          expect(slot.askOptions.length).toBe(slot.values.length);
        }
      }
    }
  });
});

describe('assistant contracts — documented interpret examples', () => {
  const resolvedExamples = [
    ['prefill', fixtures.interpretPrefillResponse],
    ['ask', fixtures.interpretAskResponse],
  ];

  test('the request example respects the utterance cap', () => {
    expect(fixtures.interpretRequest.utterance.length).toBeLessThanOrEqual(MAX_UTTERANCE_LENGTH);
    for (const slot of Object.values(fixtures.interpretRequest.memory)) {
      expect(PROVENANCE_SOURCES).toContain(slot.source);
      expect(typeof slot.turn).toBe('number');
    }
  });

  test.each(resolvedExamples)('the %s example uses only Phase 1 decisions and valid effects', (_label, response) => {
    expect(response.passthrough).toBe(false);
    expect(response.actions.length).toBe(1);
    const action = response.actions[0];
    expect(PHASE1_DECISIONS).toContain(action.decision);
    expect(EFFECTS).toContain(action.effect);
    expect(CONFIDENCE_LEVELS).toContain(action.confidence);
  });

  test.each(resolvedExamples)('the %s example records provenance for every param', (_label, response) => {
    const action = response.actions[0];
    // Provenance drives the prefill markers, the "clear AI fields" undo, and the
    // correction metric that gates launch — a param without it is invisible to
    // all three.
    for (const key of Object.keys(action.params)) {
      expect(PROVENANCE_SOURCES, `${key} provenance`).toContain(action.provenance[key]);
    }
    expect(Object.keys(action.provenance).sort()).toEqual(Object.keys(action.params).sort());
  });

  test.each(resolvedExamples)('the %s example keeps router metadata OUT of params (guardrail G3)', (_label, response) => {
    // The generation schema is `.strict()`. Metadata folded into params would
    // make every downstream generation request fail with a 400 — a mistake that
    // is easy to make because the two objects travel together.
    const action = response.actions[0];
    for (const key of METADATA_KEYS) {
      expect(action.params, `params must not contain "${key}"`).not.toHaveProperty(key);
    }
  });

  test('an "ask" names exactly the slot it is missing, with closed chip options', () => {
    const action = fixtures.interpretAskResponse.actions[0];
    expect(action.missing).toEqual([action.ask.slot]);
    expect(action.params).not.toHaveProperty(action.ask.slot);
    // Chip answers are resolved client-side, so the options must be complete
    // enough to finish the action without another server round trip.
    expect(action.ask.options.length).toBeGreaterThan(1);
    for (const option of action.ask.options) {
      expect(typeof option.label).toBe('string');
      expect(typeof option.value).toBe('string');
    }
  });

  test('a "prefill" example is complete — nothing missing', () => {
    const action = fixtures.interpretPrefillResponse.actions[0];
    expect(action.missing).toEqual([]);
    expect(action).not.toHaveProperty('ask');
  });

  test('the passthrough example carries a known reason and no actions', () => {
    const response = fixtures.interpretPassthroughResponse;
    expect(response.passthrough).toBe(true);
    expect(response.actions).toEqual([]);
    expect(PASSTHROUGH_REASONS).toContain(response.reason);
  });

  test('every example carries a correlation id', () => {
    const all = [
      fixtures.interpretPrefillResponse,
      fixtures.interpretAskResponse,
      fixtures.interpretPassthroughResponse,
    ];
    for (const response of all) {
      expect(typeof response.requestId).toBe('string');
      expect(response.requestId.length).toBeGreaterThan(0);
    }
  });

  test('memory updates use canonical values and valid sources', () => {
    for (const [name, slot] of Object.entries(fixtures.interpretPrefillResponse.memoryUpdates)) {
      expect(PROVENANCE_SOURCES, `${name} source`).toContain(slot.source);
      expect(['string', 'number']).toContain(typeof slot.value);
    }
  });
});
