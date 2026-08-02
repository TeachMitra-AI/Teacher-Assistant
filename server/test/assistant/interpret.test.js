// The interpret pipeline (Milestone M5).
//
// The pipeline's job is to be boring, and these tests are mostly about proving
// it: every stage in the right order, every failure ending in a passthrough, and
// the happy path reproducing the specification's own published payload.
//
// Every dependency is injected, so this whole file runs with no server, no key,
// no network and no Gemini. The only I/O in the module under test is the profile
// read, which arrives as a function.
//
// TWO GROUPS CARRY MOST OF THE WEIGHT:
//   - "all nine passthrough reasons", because the frozen contract promises them
//   - "nothing can make this throw", because a 5xx here is a defect (G22)

const {
  interpretRequest,
  interpretPrefillResponse,
  interpretAskResponse,
} = require('../helpers/assistantFixtures');
const { PASSTHROUGH_REASONS } = require('../../src/assistant/contracts');
const { CATALOG_VERSION } = require('../../src/actions/registry');
const { interpret } = require('../../src/assistant/interpret');

/** Both Phase 1 actions switched on. The pipeline reads flags through this. */
const ENV_ALL_ON = {
  ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
  ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
};

const REQUEST_ID = 'test-request-id';

/** A classifier stand-in returning a fixed proposal. */
const classifierReturning = (raw) =>
  vi.fn(async () => ({ ok: true, raw, metrics: { callsMade: 1 } }));

/** A classifier stand-in that failed for a given reason. */
const classifierFailing = (reason) =>
  vi.fn(async () => ({ ok: false, reason, metrics: { callsMade: 1 } }));

/** Run the pipeline with sensible defaults, overriding only what a test cares about. */
function run(input = {}, deps = {}) {
  return interpret(
    { utterance: 'Generate a Class 5 fractions worksheet', role: 'teacher', requestId: REQUEST_ID, ...input },
    {
      gemini: {},
      env: ENV_ALL_ON,
      classify: classifierReturning({ intent: 'generate_assessment', confidence: 'high', slots: {} }),
      ...deps,
    }
  );
}

describe('the happy path reproduces the specification’s published payload', () => {
  // Same technique M2 used for the catalog and M4 used for the resolver: the
  // documented example is executable, so a spec example that stops being true
  // fails the build instead of quietly rotting.
  test('spec §7.2 prefill — params, provenance and memoryUpdates all match', async () => {
    const { response } = await run(
      {
        utterance: interpretRequest.utterance,
        memory: interpretRequest.memory,
        turn: interpretRequest.turn,
      },
      {
        classify: classifierReturning({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { format: 'worksheet', topic: 'Fractions', grade: 'class 5' },
        }),
        readProfile: async () => ({ defaultLanguage: 'en' }),
      }
    );

    expect({ ...response, requestId: interpretPrefillResponse.requestId })
      .toEqual(interpretPrefillResponse);
  });

  test('spec §7.2 ask — one missing required slot produces one chip question', async () => {
    const { response } = await run(
      {
        utterance: 'a fractions worksheet for class 5',
        memory: { grade: { value: 'Class 3-5', source: 'utterance', turn: 2 } },
        turn: interpretRequest.turn,
      },
      {
        classify: classifierReturning({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { topic: 'Fractions' },
        }),
        readProfile: async () => ({ defaultLanguage: 'en' }),
      }
    );

    expect({ ...response, requestId: interpretAskResponse.requestId })
      .toEqual(interpretAskResponse);
  });

  test('memory still supplies a grade the turn does NOT state', async () => {
    // The control for the fixture above, which now reads `grade: 'utterance'`
    // because its utterance says "for class 5". Drop those words and nothing
    // else changes: memory supplies the same value and is labelled as memory.
    // Without this, a bug that made recovery fabricate grades would look like a
    // passing suite.
    const { response } = await run(
      {
        utterance: 'a fractions worksheet',
        memory: { grade: { value: 'Class 3-5', source: 'utterance', turn: 2 } },
        turn: interpretRequest.turn,
      },
      {
        classify: classifierReturning({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { topic: 'Fractions' },
        }),
        readProfile: async () => ({ defaultLanguage: 'en' }),
      }
    );

    expect(response.actions[0].params.grade).toBe('Class 3-5');
    expect(response.actions[0].provenance.grade).toBe('memory');
  });

  test('recovery fills a grade the model missed, and reports it in telemetry', async () => {
    const { response, telemetry } = await run(
      {
        utterance: 'make a worksheet on fractions for class 5',
        turn: interpretRequest.turn,
      },
      {
        classify: classifierReturning({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { format: 'worksheet', topic: 'Fractions' },
        }),
        readProfile: async () => ({}),
      }
    );

    expect(response.actions[0].params.grade).toBe('Class 3-5');
    expect(response.actions[0].provenance.grade).toBe('utterance');
    // Names only — never the recovered value (G11).
    expect(telemetry.recoveredSlots).toEqual(['grade']);
    expect(JSON.stringify(telemetry)).not.toContain('Class 3-5');
  });

  test('a turn with nothing recoverable adds no recovery fields to the log', async () => {
    const { telemetry } = await run(
      { utterance: 'make a worksheet on fractions', turn: interpretRequest.turn },
      {
        classify: classifierReturning({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { format: 'worksheet', topic: 'Fractions' },
        }),
        readProfile: async () => ({}),
      }
    );

    expect(telemetry.recoveredSlots).toBeUndefined();
    expect(telemetry.recoveryRejected).toBeUndefined();
    expect(telemetry.recoverySkipped).toEqual(['grade', 'subject']);
  });
});

describe('all nine passthrough reasons', () => {
  test('not_an_action — the model reports it has no action for this', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({ intent: 'coach_question', confidence: 'high' }),
    });
    expect(response).toMatchObject({ passthrough: true, actions: [], reason: 'not_an_action' });
  });

  test('not_an_action — an utterance that normalizes to nothing', async () => {
    // Zero-width characters only. Never reaches the classifier.
    const classify = classifierReturning({ intent: 'generate_assessment', confidence: 'high' });
    const { response } = await run({ utterance: '​​﻿' }, { classify });
    expect(response.reason).toBe('not_an_action');
    expect(classify).not.toHaveBeenCalled();
  });

  test('low_confidence — the model is guessing', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({ intent: 'generate_assessment', confidence: 'low', slots: {} }),
    });
    expect(response.reason).toBe('low_confidence');
  });

  test('low_confidence — medium confidence with a close rival', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'medium',
        alternatives: [{ intent: 'open_generator', confidence: 'medium' }],
        slots: {},
      }),
    });
    expect(response.reason).toBe('low_confidence');
  });

  test('disabled — every action is flagged off for this caller', async () => {
    const classify = classifierReturning({ intent: 'generate_assessment', confidence: 'high' });
    const { response } = await run({}, { env: {}, classify });
    expect(response.reason).toBe('disabled');
    // And no model call was spent discovering there was nothing to classify.
    expect(classify).not.toHaveBeenCalled();
  });

  test('classifier_timeout — the routing budget elapsed', async () => {
    const { response } = await run({}, { classify: classifierFailing('classifier_timeout') });
    expect(response.reason).toBe('classifier_timeout');
  });

  test('classifier_error — upstream failure or unparseable response', async () => {
    const { response } = await run({}, { classify: classifierFailing('classifier_error') });
    expect(response.reason).toBe('classifier_error');
  });

  test('safety_blocked — Gemini’s own filters', async () => {
    const { response } = await run({}, { classify: classifierFailing('safety_blocked') });
    expect(response.reason).toBe('safety_blocked');
  });

  test('invalid_proposal — a fabricated action id (G4)', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({ intent: 'delete_all_resources', confidence: 'high' }),
    });
    expect(response.reason).toBe('invalid_proposal');
  });

  test('budget_exhausted — the per-user daily cap', async () => {
    const classify = classifierReturning({ intent: 'generate_assessment', confidence: 'high' });
    const { response } = await run({}, { checkBudget: async () => false, classify });
    expect(response.reason).toBe('budget_exhausted');
    expect(classify).not.toHaveBeenCalled();
  });

  test('emergency_detected — and the classifier is never called (G10)', async () => {
    const classify = classifierReturning({ intent: 'generate_assessment', confidence: 'high' });
    const { response } = await run({ utterance: 'a student is unconscious' }, { classify });

    expect(response.reason).toBe('emergency_detected');
    expect(classify).not.toHaveBeenCalled();
  });

  test('every reason emitted is a member of the frozen vocabulary', async () => {
    const emitted = new Set();
    for (const reason of ['classifier_timeout', 'classifier_error', 'safety_blocked']) {
      const { response } = await run({}, { classify: classifierFailing(reason) });
      emitted.add(response.reason);
    }
    for (const reason of emitted) expect(PASSTHROUGH_REASONS).toContain(reason);
  });
});

describe('stage ordering', () => {
  test('the emergency check runs BEFORE the budget and the catalog', async () => {
    // If the ordering ever inverts, an emergency during a quota outage would
    // report the wrong reason — and, far worse, an emergency would start
    // depending on a flag being on.
    const checkBudget = vi.fn(async () => false);
    const { response } = await run(
      { utterance: 'a student collapsed and is not breathing' },
      { env: {}, checkBudget }
    );

    expect(response.reason).toBe('emergency_detected');
    expect(checkBudget).not.toHaveBeenCalled();
  });

  test('a teaching question about an emergency is NOT short-circuited', async () => {
    // The existing guard already separates these; this asserts the router
    // inherits that distinction rather than re-deriving it.
    const classify = classifierReturning({ intent: 'coach_question', confidence: 'high' });
    await run({ utterance: 'how do I teach first aid to my students?' }, { classify });
    expect(classify).toHaveBeenCalled();
  });

  test('the profile is read only once a real action has been proposed', async () => {
    // A passthrough must not cost a database query. Most messages are
    // passthroughs, so this is the difference between one extra read per
    // routed turn and one per message sent in the whole app.
    const readProfile = vi.fn(async () => ({}));
    await run({}, {
      classify: classifierReturning({ intent: 'coach_question', confidence: 'high' }),
      readProfile,
    });
    expect(readProfile).not.toHaveBeenCalled();

    await run({}, { readProfile });
    expect(readProfile).toHaveBeenCalledTimes(1);
  });
});

describe('the response envelope', () => {
  test('router metadata sits BESIDE params, never inside it (G3)', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'high',
        slots: { format: 'quiz', topic: 'fractions' },
      }),
    });

    const [action] = response.actions;
    for (const key of ['provenance', 'confidence', 'requestId', 'decision', 'effect', 'missing']) {
      expect(action.params).not.toHaveProperty(key);
    }
    expect(action).toHaveProperty('provenance');
    expect(action).toHaveProperty('confidence');
  });

  test('params contain ONLY keys the action’s real schema accepts', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'high',
        slots: { format: 'quiz', topic: 'fractions', schoolId: 'abc', role: 'admin' },
      }),
    });

    const schema = require('../../src/actions/schemas/generateAssessment').generateAssessmentSchema;
    for (const key of Object.keys(response.actions[0].params)) {
      expect(Object.keys(schema.shape)).toContain(key);
    }
  });

  test('carries the live catalog version, so a stale client can notice', async () => {
    const { response } = await run();
    expect(response.catalogVersion).toBe(CATALOG_VERSION);
  });

  test('an `ask` turn offers no memoryUpdates', async () => {
    // A turn that ended in a question has settled nothing. Remembering its
    // half-formed reading would let a guess outlive the question meant to
    // resolve it.
    const { response } = await run({}, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'high',
        slots: { topic: 'fractions' },
      }),
    });
    expect(response.actions[0].decision).toBe('ask');
    expect(response).not.toHaveProperty('memoryUpdates');
  });

  test('a passthrough carries no actions and no memoryUpdates', async () => {
    const { response } = await run({}, {
      classify: classifierReturning({ intent: 'coach_question', confidence: 'high' }),
    });
    expect(response.actions).toEqual([]);
    expect(response).not.toHaveProperty('memoryUpdates');
  });

  test('open_generator resolves to a prefill with empty params', async () => {
    const { response } = await run({ utterance: 'open the generator' }, {
      classify: classifierReturning({ intent: 'open_generator', confidence: 'high' }),
    });
    expect(response.actions[0]).toMatchObject({
      actionId: 'open_generator',
      effect: 'read',
      decision: 'prefill',
      params: {},
      missing: [],
    });
  });
});

describe('no input can produce `execute`', () => {
  test('not at any confidence, for either Phase 1 action', async () => {
    for (const intent of ['generate_assessment', 'open_generator']) {
      for (const confidence of ['high', 'medium', 'low']) {
        const { response } = await run({}, {
          classify: classifierReturning({
            intent,
            confidence,
            slots: { format: 'quiz', topic: 'fractions' },
          }),
        });
        for (const action of response.actions) {
          expect(action.decision).not.toBe('execute');
          expect(['prefill', 'ask']).toContain(action.decision);
        }
      }
    }
  });
});

describe('nothing can make this throw (G22)', () => {
  const hostile = [
    ['a classifier that rejects', { classify: async () => { throw new Error('boom'); } }],
    ['a profile reader that rejects', { readProfile: async () => { throw new Error('db down'); } }],
    ['a budget check that rejects', { checkBudget: async () => { throw new Error('nope'); } }],
    ['a classifier returning garbage', { classify: async () => ({ ok: true, raw: 'not an object' }) }],
    ['a classifier returning nothing', { classify: async () => ({ ok: true }) }],
    ['a malformed classifier result', { classify: async () => null }],
  ];

  test.each(hostile)('survives %s', async (_name, deps) => {
    const { response } = await run({}, deps);
    expect(response.passthrough).toBe(true);
    expect(response.actions).toEqual([]);
    expect(PASSTHROUGH_REASONS).toContain(response.reason);
  });

  test('an internal defect reports classifier_error and logs the detail', async () => {
    const { response, telemetry } = await run({}, {
      classify: async () => { throw new Error('a genuine bug'); },
    });
    expect(response.reason).toBe('classifier_error');
    // The distinguishing detail goes to the log, where it is actionable —
    // never to the teacher, who must not be able to tell these apart.
    expect(telemetry.internalError).toBe('a genuine bug');
    expect(response).not.toHaveProperty('internalError');
  });

  test('survives hostile memory and profile shapes', async () => {
    for (const memory of [null, 'text', 42, [], { grade: null }, { grade: 'raw' }]) {
      const { response } = await run({ memory }, {});
      expect(response).toBeDefined();
      expect(response.catalogVersion).toBe(CATALOG_VERSION);
    }
    for (const profile of [null, 'text', 42, []]) {
      const { response } = await run({}, { readProfile: async () => profile });
      expect(response).toBeDefined();
    }
  });
});

describe('telemetry carries no teacher text (G11)', () => {
  test('the decision log holds ids, enums and counts only', async () => {
    const utterance = 'Generate a Class 5 worksheet about photosynthesis in mangroves';
    const { telemetry } = await run({ utterance }, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'high',
        slots: { format: 'worksheet', topic: 'photosynthesis in mangroves', grade: 'class 5' },
      }),
    });

    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain('photosynthesis');
    expect(serialized).not.toContain('mangroves');
    expect(serialized).not.toContain(utterance);

    // What it DOES carry: enough to compute decision rates and latency.
    expect(telemetry).toMatchObject({
      decision: 'prefill',
      actionId: 'generate_assessment',
      confidence: 'high',
      missingCount: 0,
    });
    expect(typeof telemetry.latencyMs).toBe('number');
  });

  test('a dropped-slot COUNT is reported, never the dropped values', async () => {
    const { telemetry } = await run({}, {
      classify: classifierReturning({
        intent: 'generate_assessment',
        confidence: 'high',
        slots: { format: 'quiz', topic: 'fractions', secretField: 'sensitive value' },
      }),
    });
    expect(telemetry.droppedSlots).toBe(1);
    expect(JSON.stringify(telemetry)).not.toContain('sensitive value');
  });
});
