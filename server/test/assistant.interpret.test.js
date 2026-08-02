// Milestone M5 — POST /api/assistant/interpret, end to end.
//
// The pipeline's own logic is unit-tested in test/assistant/interpret.test.js.
// What is checked HERE is everything that only exists once the endpoint is real:
// the HTTP error contract, the rollout gates, the actual GeminiService instance
// (geminiFast, driven through a stubbed fetch, so gemini.js and the output guard
// are genuinely exercised), and the promise this milestone is judged on —
//
//     THIS ENDPOINT NEVER RETURNS A 5xx.
//
// It returns non-2xx for exactly three things: auth (401), a malformed envelope
// (400), and rate limiting (429). Everything else is a 200 carrying
// passthrough: true, because this sits in front of a text box and an error here
// would be a toast on a feature the teacher did not knowingly invoke.
//
// Flags are manipulated through process.env and restored afterwards; the route
// reads them per request, so this works against the shared app instance.

const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited, geminiInputBlocked } = require('./helpers/geminiMock');
const { MAX_UTTERANCE_LENGTH, PASSTHROUGH_REASONS } = require('../src/assistant/contracts');
const { CATALOG_VERSION } = require('../src/actions/registry');

const ASSISTANT_ENV_KEYS = [
  'ASSISTANT_ENABLED',
  'ASSISTANT_ACTION_GENERATE_ASSESSMENT',
  'ASSISTANT_ACTION_OPEN_GENERATOR',
  'ASSISTANT_ALLOWED_ROLES',
  'ASSISTANT_ALLOWED_SCHOOL_CODES',
];

let fixtures;
let teacherToken;
let savedEnv;

function enableAssistant(overrides = {}) {
  process.env.ASSISTANT_ENABLED = 'true';
  process.env.ASSISTANT_ACTION_GENERATE_ASSESSMENT = 'true';
  process.env.ASSISTANT_ACTION_OPEN_GENERATOR = 'true';
  process.env.ASSISTANT_ALLOWED_ROLES = 'teacher';
  delete process.env.ASSISTANT_ALLOWED_SCHOOL_CODES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearAssistantEnv() {
  for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
}

/** POST an utterance as the fixture teacher. */
function interpret(body) {
  return request(app)
    .post('/api/assistant/interpret')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send(body);
}

/** A Gemini response carrying a well-formed proposal. */
const proposalResponse = (proposal) => geminiSuccess(JSON.stringify(proposal));

const GOOD_PROPOSAL = {
  intent: 'generate_assessment',
  confidence: 'high',
  slots: { format: 'worksheet', topic: 'fractions', grade: 'class 5' },
};

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'asstint');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ASSISTANT_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearAssistantEnv();
  vi.unstubAllGlobals();
});

describe('authentication', () => {
  test('requires a token', async () => {
    const res = await request(app).post('/api/assistant/interpret').send({ utterance: 'hello' });
    expect(res.status).toBe(401);
  });

  test('rejects a garbage token', async () => {
    const res = await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ utterance: 'hello' });
    expect(res.status).toBe(401);
  });

  test('authentication is checked before the kill switch', async () => {
    // A disabled assistant must not become an authentication bypass, and an
    // unauthenticated caller must not be able to probe whether it is on.
    clearAssistantEnv();
    const res = await request(app).post('/api/assistant/interpret').send({ utterance: 'hello' });
    expect(res.status).toBe(401);
  });
});

describe('disabled by default', () => {
  test('an unconfigured deployment returns an inert passthrough, not an error', async () => {
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      catalogVersion: 0,
      passthrough: true,
      actions: [],
      reason: 'disabled',
    });
    // The headline guarantee: no model call, no cost, no latency.
    expect(mock).not.toHaveBeenCalled();
  });

  test('a role outside the rollout gets the same inert passthrough', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'admin' });
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('disabled');
    expect(mock).not.toHaveBeenCalled();
  });

  test('a school outside the rollout gets the same inert passthrough', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: 'SOMEOTHERSCHOOL' });
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });
    expect(res.body.reason).toBe('disabled');
  });

  test('the kill switch is checked before the envelope', async () => {
    // Stage 1 does no work. A malformed request to a disabled assistant is a
    // passthrough, not a 400 — there is nothing to validate against.
    const res = await interpret({ utterance: '' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('disabled');
  });
});

describe('the envelope — the only 400 this endpoint produces', () => {
  beforeEach(() => enableAssistant());

  const bad = [
    ['a missing utterance', {}],
    ['an empty utterance', { utterance: '' }],
    ['a whitespace-only utterance', { utterance: '     ' }],
    ['a non-string utterance', { utterance: 42 }],
    ['a null utterance', { utterance: null }],
    ['an oversized utterance', { utterance: 'x'.repeat(MAX_UTTERANCE_LENGTH + 1) }],
    ['an unknown top-level key', { utterance: 'hi', nonsense: true }],
    ['a malformed pendingAsk', { utterance: 'hi', pendingAsk: { slot: 5 } }],
    ['a malformed memory entry', { utterance: 'hi', memory: { grade: { value: {} } } }],
    ['a non-integer turn', { utterance: 'hi', turn: 1.5 }],
  ];

  test.each(bad)('rejects %s with a 400 and a requestId', async (_name, body) => {
    const res = await interpret(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('requestId');
  });

  test('accepts an utterance exactly at the limit', async () => {
    mockGeminiFetch([proposalResponse({ intent: 'coach_question', confidence: 'high' })]);
    const res = await interpret({ utterance: 'x'.repeat(MAX_UTTERANCE_LENGTH) });
    expect(res.status).toBe(200);
  });

  test('accepts the full documented envelope', async () => {
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({
      utterance: 'Generate a Class 5 fractions worksheet',
      catalogVersion: CATALOG_VERSION,
      memory: { subject: { value: 'Mathematics', source: 'utterance', turn: 2 } },
      pendingAsk: null,
      turn: 3,
      sequence: 7,
    });
    expect(res.status).toBe(200);
    expect(res.body.passthrough).toBe(false);
  });

  test('the utterance cap matches the coach’s, so no message is routable but unaskable', async () => {
    // A message /api/coach would accept must never be rejected by the router
    // for being too long — the router sits in front of the same composer.
    expect(MAX_UTTERANCE_LENGTH).toBe(500);
  });
});

describe('the happy path, through the real GeminiService', () => {
  beforeEach(() => enableAssistant());

  test('a routable utterance produces a prefill', async () => {
    const { mock, calls } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      catalogVersion: CATALOG_VERSION,
      passthrough: false,
    });

    const [action] = res.body.actions;
    expect(action).toMatchObject({
      actionId: 'generate_assessment',
      version: 1,
      effect: 'draft',
      decision: 'prefill',
      confidence: 'high',
    });
    // Canonicalized in code, never by the model: "class 5" became "Class 3-5".
    expect(action.params.grade).toBe('Class 3-5');
    expect(action.provenance.grade).toBe('utterance');

    // The request actually asked for structured output against a
    // registry-derived enum.
    const { generationConfig } = calls[0].body;
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.responseSchema.properties.intent.enum).toContain('generate_assessment');
  });

  test('the routing instance is used, not the coaching one (G20)', async () => {
    const { calls } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    // A small output cap is the visible fingerprint of geminiFast; the coach
    // instance runs at 8192.
    expect(calls[0].body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(1024);
    expect(calls[0].url).toContain('flash-lite');
  });

  test('the teacher’s text is delimited user content, never system instruction', async () => {
    const utterance = 'Generate a worksheet on quadrilaterals';
    const { calls } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    await interpret({ utterance });

    const { systemInstruction, contents } = calls[0].body;
    expect(JSON.stringify(contents)).toContain('quadrilaterals');
    expect(JSON.stringify(systemInstruction)).not.toContain('quadrilaterals');
  });

  test('session memory fills a slot the utterance did not', async () => {
    mockGeminiFetch([proposalResponse({
      intent: 'generate_assessment',
      confidence: 'high',
      slots: { format: 'worksheet', topic: 'fractions' },
    })]);

    const res = await interpret({
      utterance: 'make a fractions worksheet',
      memory: { grade: { value: 'Class 3-5', source: 'utterance', turn: 2 } },
      turn: 3,
    });

    expect(res.body.actions[0].params.grade).toBe('Class 3-5');
    expect(res.body.actions[0].provenance.grade).toBe('memory');
  });

  test('one missing required slot produces one chip question and no navigation', async () => {
    mockGeminiFetch([proposalResponse({
      intent: 'generate_assessment',
      confidence: 'high',
      slots: { topic: 'fractions' },
    })]);

    const res = await interpret({ utterance: 'a fractions test' });
    const [action] = res.body.actions;
    expect(action.decision).toBe('ask');
    expect(action.missing).toEqual(['format']);
    expect(action.ask).toEqual({
      slot: 'format',
      question: 'Quiz or worksheet?',
      options: [
        { label: 'Quiz', value: 'quiz' },
        { label: 'Worksheet', value: 'worksheet' },
      ],
    });
  });
});

describe('the emergency short-circuit (G10)', () => {
  beforeEach(() => enableAssistant());

  const emergencies = [
    'a student is unconscious',
    'a child collapsed and is not breathing',
    'there is a fire in the classroom',
  ];

  test.each(emergencies)('"%s" never reaches Gemini', async (utterance) => {
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance });

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('emergency_detected');
    // The assertion this whole milestone's safety argument rests on.
    expect(mock).not.toHaveBeenCalled();
  });

  test('a question ABOUT teaching first aid is still classified normally', async () => {
    const { mock } = mockGeminiFetch([proposalResponse({ intent: 'coach_question', confidence: 'high' })]);
    const res = await interpret({ utterance: 'how do I teach first aid to my students?' });

    expect(res.body.reason).toBe('not_an_action');
    expect(mock).toHaveBeenCalled();
  });
});

describe('the model cannot escalate (G4, G8)', () => {
  beforeEach(() => enableAssistant());

  test('a fabricated action id yields a passthrough', async () => {
    mockGeminiFetch([proposalResponse({ intent: 'delete_all_resources', confidence: 'high' })]);
    const res = await interpret({ utterance: 'delete everything' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ passthrough: true, actions: [], reason: 'invalid_proposal' });
  });

  test('an action whose flag is OFF cannot be proposed, even though it exists', async () => {
    enableAssistant({ ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'false' });
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.body).toMatchObject({ passthrough: true, reason: 'invalid_proposal' });
  });

  test('a proposal carrying a decision or a route is rejected entirely', async () => {
    mockGeminiFetch([proposalResponse({
      ...GOOD_PROPOSAL,
      decision: 'execute',
      route: '/generator',
    })]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });
    expect(res.body).toMatchObject({ passthrough: true, reason: 'invalid_proposal' });
  });

  test('no response ever carries decision: execute', async () => {
    for (const confidence of ['high', 'medium', 'low']) {
      mockGeminiFetch([proposalResponse({ ...GOOD_PROPOSAL, confidence })]);
      const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });
      for (const action of res.body.actions) expect(action.decision).not.toBe('execute');
    }
  });

  test('a value the real schema rejects is dropped, not clamped', async () => {
    mockGeminiFetch([proposalResponse({
      intent: 'generate_assessment',
      confidence: 'high',
      slots: { format: 'worksheet', topic: 'fractions', questionCount: '500' },
    })]);

    const res = await interpret({ utterance: 'Generate 500 questions on fractions' });
    // 500 is refused, and the registry default stands in — visibly, in a form
    // field the teacher can see. Clamping to 30 would look like the application
    // understood and agreed.
    expect(res.body.actions[0].params.questionCount).toBe(10);
    expect(res.body.actions[0].provenance.questionCount).toBe('default');
  });

  test('a format outside the enum becomes a question, not a guess', async () => {
    mockGeminiFetch([proposalResponse({
      intent: 'generate_assessment',
      confidence: 'high',
      slots: { format: 'test paper', topic: 'fractions' },
    })]);

    const res = await interpret({ utterance: 'make a test paper on fractions' });
    expect(res.body.actions[0].decision).toBe('ask');
    expect(res.body.actions[0].missing).toEqual(['format']);
  });

  test('params never carry router metadata (G3)', async () => {
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    const { params } = res.body.actions[0];
    for (const key of ['provenance', 'confidence', 'requestId', 'decision', 'effect']) {
      expect(params).not.toHaveProperty(key);
    }
  });

  test('the response never exposes a schema, a role list or a flag (G7)', async () => {
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    const serialized = JSON.stringify(res.body);
    for (const forbidden of ['paramSchema', 'requiredRoles', 'featureFlag', 'autoExecute', 'ASSISTANT_']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('NO PATH RETURNS A 5xx (G22)', () => {
  beforeEach(() => enableAssistant());

  const upstreamFailures = [
    ['an upstream 429', [geminiRateLimited(1)]],
    ['an upstream 500', [{ status: 500, text: 'server error' }]],
    ['a blocked input', [geminiInputBlocked()]],
    ['a network failure', [{ reject: new Error('fetch failed') }]],
    ['a timeout', [{ reject: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }]],
    ['prose instead of JSON', [geminiSuccess('I am sorry, I cannot help with that.')]],
    ['truncated JSON', [geminiSuccess('{"intent":"generate_ass')]],
    ['an empty response', [geminiSuccess('')]],
    ['a JSON array instead of an object', [geminiSuccess('[]')]],
    ['a proposal with a float confidence', [proposalResponse({ intent: 'generate_assessment', confidence: 0.9 })]],
    ['a proposal missing its intent', [proposalResponse({ confidence: 'high' })]],
    ['a null proposal', [geminiSuccess('null')]],
  ];

  test.each(upstreamFailures)('%s still returns 200 + passthrough', async (_name, queue) => {
    mockGeminiFetch(queue);
    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(res.body.passthrough).toBe(true);
    expect(res.body.actions).toEqual([]);
    expect(PASSTHROUGH_REASONS).toContain(res.body.reason);
    expect(res.body).toHaveProperty('requestId');
  });

  test('every failure is indistinguishable to the teacher', async () => {
    // Nine reasons, one experience. The reason is diagnostic and is never shown.
    const shapes = new Set();
    for (const [, queue] of upstreamFailures) {
      mockGeminiFetch(queue);
      const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });
      shapes.add(Object.keys(res.body).sort().join(','));
    }
    expect(shapes.size).toBe(1);
  });

  test('a database failure during the ROLLOUT GATE degrades, it does not 500', async () => {
    // REGRESSION, M5. This returned 500 until the gate was made to fail closed.
    // It was missed by every other test here because the failure lives OUTSIDE
    // the pipeline's total catch — in the school-code lookup, which only runs
    // when a school allow-list is configured. Found by disabling the total catch
    // and noticing the integration suite did not care, which meant something
    // upstream of the pipeline was unprotected.
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: 'SOMECODE' });
    const spy = vi.spyOn(prisma.school, 'findUnique').mockRejectedValue(new Error('db is gone'));

    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    // Fails CLOSED: a database we cannot read is never permission granted.
    expect(res.body).toMatchObject({ passthrough: true, reason: 'disabled' });

    spy.mockRestore();
  });

  test('the same database failure leaves the CATALOG inert rather than erroring', async () => {
    // The gate is shared, so the fix serves both endpoints. Asserted here
    // because "not enabled for you" being a normal state — not an error — is
    // the catalog's entire design, and a 500 broke that promise too.
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: 'SOMECODE' });
    const spy = vi.spyOn(prisma.school, 'findUnique').mockRejectedValue(new Error('db is gone'));

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });

    spy.mockRestore();
  });

  test('a database failure during the profile read degrades, it does not 500', async () => {
    const spy = vi.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('db is gone'));
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'Generate a Class 5 fractions worksheet' });
    expect(res.status).toBe(200);
    // The profile just contributes nothing; the rest of the prefill survives.
    expect(res.body.actions[0].params.topic).toBe('fractions');

    spy.mockRestore();
  });
});

describe('rate limiting and privacy', () => {
  beforeEach(() => enableAssistant());

  test('the assistant limiter is applied to this path', async () => {
    // Exhausting the bucket is an M9 concern; what matters here is that the
    // route is INSIDE it, which the standard headers prove.
    mockGeminiFetch([proposalResponse({ intent: 'coach_question', confidence: 'high' })]);
    const res = await interpret({ utterance: 'hello' });
    expect(res.headers).toHaveProperty('ratelimit-limit');
  });

  test('no log line carries the teacher’s words (G11)', async () => {
    const utterance = 'Generate a worksheet about photosynthesis in mangrove swamps';
    const logged = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });

    mockGeminiFetch([proposalResponse({
      intent: 'generate_assessment',
      confidence: 'high',
      slots: { format: 'worksheet', topic: 'photosynthesis in mangrove swamps' },
    })]);
    await interpret({ utterance });
    spy.mockRestore();

    const all = logged.join('\n');
    expect(all).toContain('interpret_completed');
    expect(all).not.toContain('photosynthesis');
    expect(all).not.toContain('mangrove');
    expect(all).not.toContain(utterance);
  });

  test('the response echoes no teacher text beyond the resolved params', async () => {
    // `topic` legitimately appears — it IS the resolved parameter the Generator
    // will be prefilled with. What must not appear is the raw utterance.
    const utterance = 'please could you kindly generate a worksheet on fractions for me';
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const res = await interpret({ utterance });
    expect(JSON.stringify(res.body)).not.toContain(utterance);
  });
});
