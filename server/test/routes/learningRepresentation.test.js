// AI Learning Representation System — POST /api/coach/learning-representation,
// end to end (ADR Phase D).
//
// The pipeline's own logic is unit-tested in test/learningRepresentation/.
// What is checked HERE is everything that only exists once the endpoint is
// real: the HTTP error contract, the rollout gate, and the real
// GeminiService instances (geminiFast for classify, gemini for render)
// driven through a stubbed fetch — so gemini.js and the output guard are
// genuinely exercised, and the TWO-CALL sequence (classify then render) is
// proven to happen in that order.
//
// Mirrors test/assistant.interpret.test.js's central promise:
//
//     THIS ENDPOINT NEVER RETURNS A 5xx.
//
// Non-2xx is reserved for exactly three things: auth (401), a malformed
// envelope (400), and rate limiting (429). Everything else is a 200 —
// either a real representation or the universal
// `{representation: 'verbal_explanation', data: null}` shape.

const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited, geminiInputBlocked } = require('../helpers/geminiMock');

const ENV_KEYS = [
  'LEARNING_REPRESENTATION_ENABLED',
  'LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES',
  'LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER',
];

let fixtures;
let teacherToken;
let savedEnv;

function enableFeature(overrides = {}) {
  process.env.LEARNING_REPRESENTATION_ENABLED = 'true';
  delete process.env.LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES;
  delete process.env.LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function post(body) {
  return request(app)
    .post('/api/coach/learning-representation')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send(body);
}

const VALID_BODY = { prompt: 'Explain the water cycle.', answer: 'Water evaporates, condenses, then falls as rain.' };

const HIGH_CONFIDENCE_PROCESS = { intent: 'explain_process', confidence: 'high' };
const PROCESS_DATA = {
  steps: [
    { label: 'Evaporation', description: 'The sun heats water, turning it into vapour.' },
    { label: 'Condensation', description: 'Vapour cools and forms clouds.' },
  ],
};

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'lrepe2e');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe('authentication', () => {
  test('requires a token', async () => {
    const res = await request(app).post('/api/coach/learning-representation').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  test('authentication is checked before the kill switch', async () => {
    clearEnv();
    const res = await request(app).post('/api/coach/learning-representation').send(VALID_BODY);
    expect(res.status).toBe(401);
  });
});

describe('the kill switch — default OFF', () => {
  test('with the feature unconfigured, responds inert 200 rather than 503/404', async () => {
    clearEnv();
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
    expect(typeof res.body.requestId).toBe('string');
  });

  test('makes no Gemini call at all when disabled', async () => {
    clearEnv();
    const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    await post(VALID_BODY);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  test('rejects an empty body with 400', async () => {
    enableFeature();
    const res = await post({});
    expect(res.status).toBe(400);
  });

  test('rejects a missing "answer" with 400', async () => {
    enableFeature();
    const res = await post({ prompt: 'x' });
    expect(res.status).toBe(400);
  });

  test('rejects an unknown extra field with 400 (.strict())', async () => {
    enableFeature();
    const res = await post({ ...VALID_BODY, extra: 'nope' });
    expect(res.status).toBe(400);
  });

  test('rejects a prompt over the length bound with 400', async () => {
    enableFeature();
    const res = await post({ ...VALID_BODY, prompt: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });
});

describe('the happy path — two calls, in order: classify then render', () => {
  test('a confident, renderable intent returns the structured representation', async () => {
    enableFeature();
    const { calls } = mockGeminiFetch([
      geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)),
      geminiSuccess(JSON.stringify(PROCESS_DATA)),
    ]);

    const res = await post(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      requestId: expect.any(String),
      representation: 'process_diagram',
      data: PROCESS_DATA,
    });

    // Two calls were made, and the second (render) is grounded in the
    // ANSWER — proving the pipeline actually threaded it through, not just
    // the prompt.
    expect(calls).toHaveLength(2);
    const secondCallBody = JSON.stringify(calls[1].body);
    expect(secondCallBody).toContain(VALID_BODY.answer);
  });

  test('no_visualization intent renders nothing and makes only ONE call (classify)', async () => {
    enableFeature();
    const { calls } = mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'no_visualization', confidence: 'high' }))]);

    const res = await post(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
    // The render call is never made for an intent that doesn't need one —
    // no wasted second Gemini call.
    expect(calls).toHaveLength(1);
  });

  test('low confidence abstains and never reaches the render call', async () => {
    enableFeature();
    const { calls } = mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'explain_process', confidence: 'low' }))]);

    const res = await post(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
    expect(calls).toHaveLength(1);
  });
});

describe('every non-auth, non-validation, non-rate-limit outcome is a 200 abstain', () => {
  test('a classifier safety block', async () => {
    enableFeature();
    mockGeminiFetch([geminiInputBlocked()]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
  });

  test('an upstream 429 on the classify call', async () => {
    enableFeature();
    mockGeminiFetch([geminiRateLimited(), geminiRateLimited(), geminiRateLimited()]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
  });

  test('a render call that fails after a confident classification still returns 200 abstain', async () => {
    enableFeature();
    mockGeminiFetch([
      geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)),
      geminiSuccess('not valid json at all'),
    ]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
  });

  test('a render response that violates its own schema still returns 200 abstain', async () => {
    enableFeature();
    mockGeminiFetch([
      geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)),
      geminiSuccess(JSON.stringify({ steps: [{ label: 'only one step, no description' }] })),
    ]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
  });
});

describe('the school allow-list is a filter, not a gate', () => {
  test('an empty allow-list means every school in the rollout', async () => {
    enableFeature();
    mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'no_visualization', confidence: 'high' }))]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.representation).toBe('verbal_explanation');
  });

  test('a non-empty allow-list that excludes this school abstains without calling Gemini', async () => {
    enableFeature({ LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES: 'SOME-OTHER-SCHOOL' });
    const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
    expect(mock).not.toHaveBeenCalled();
  });
});
