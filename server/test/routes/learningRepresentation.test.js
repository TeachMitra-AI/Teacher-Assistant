// POST /api/coach/learning-representation, end to end. The pipeline's logic is unit-tested in test/learningRepresentation/;
// here it's everything that only exists once the endpoint is real: the HTTP error contract, the rollout gate, and the
// real GeminiService instances (geminiFast for classify, gemini for render) driven through a stubbed fetch, so
// gemini.js and the output guard are exercised and the two-call sequence (classify then render) is proven in order.
// Like test/assistant.interpret.test.js, the central promise is that this endpoint never returns a 5xx: non-2xx only
// for auth (401), a malformed envelope (400) and rate limiting (429). Everything else is a 200, a real representation
// or the universal `{representation: 'verbal_explanation', data: null}`.

const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited, geminiInputBlocked } = require('../helpers/geminiMock');
const { setBoolSetting, LEARNING_REPRESENTATION_SETTING_KEY } = require('../../src/lib/systemSettings');

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
  // The render cache is a singleton on the shared app (built once in index.js), so without a reset a successful render
  // would short-circuit a later test's mocked Gemini call with a cache hit; several tests reuse VALID_BODY and the same
  // intent to test different outcomes for what would be an identical cache key.
  app.locals.learningRepresentationRenderCache?.clear();
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

describe('Admin Settings > Feature Management override precedence', () => {
  afterEach(async () => {
    // These tests set a SystemSetting override directly, which the shared beforeEach's clearEnv() doesn't touch; cleaned
    // up here so it can't leak into a later test that assumes the env var alone controls the gate.
    await prisma.systemSetting.deleteMany({ where: { key: LEARNING_REPRESENTATION_SETTING_KEY } });
  });

  test('an override enabling the flag takes effect even with the env var unset', async () => {
    clearEnv(); // LEARNING_REPRESENTATION_ENABLED unset -> env default is OFF
    await setBoolSetting(LEARNING_REPRESENTATION_SETTING_KEY, true, 'test-admin');
    const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'no_visualization', confidence: 'high' }))]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalled();
  });

  test('an override disabling the flag takes effect even with the env var on', async () => {
    enableFeature(); // LEARNING_REPRESENTATION_ENABLED=true -> env default is ON
    await setBoolSetting(LEARNING_REPRESENTATION_SETTING_KEY, false, 'test-admin');
    const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
    expect(mock).not.toHaveBeenCalled();
  });

  test('with no override row, the env var alone still governs (unchanged baseline behavior)', async () => {
    clearEnv();
    const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ representation: 'verbal_explanation', data: null });
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

  // Regression for a bug found in manual QA: a normal ~6.5k-character Coach answer exceeded the original 6000-character bound and surfaced zod's raw validation text to the teacher.
  describe('the answer length bound and its error message (found via manual QA)', () => {
    test('a real-world-length answer (~7000 chars) is accepted, not rejected', async () => {
      enableFeature();
      const longButRealistic = 'A'.repeat(7000);
      mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'no_visualization', confidence: 'high' }))]);
      const res = await post({ ...VALID_BODY, answer: longButRealistic });
      expect(res.status).toBe(200);
    });

    test('an answer over the (raised) bound gets a friendly message, never the raw zod text', async () => {
      enableFeature();
      const res = await post({ ...VALID_BODY, answer: 'A'.repeat(12001) });
      expect(res.status).toBe(400);
      expect(res.body.error).not.toMatch(/zod|<=|expected string/i);
      expect(res.body.error).toMatch(/too long/i);
    });

    test('a missing prompt gets a friendly, field-specific message', async () => {
      enableFeature();
      const res = await post({ answer: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A question is required.');
    });

    test('a fully empty body reports the missing prompt first (zod validates it first)', async () => {
      enableFeature();
      const res = await post({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A question is required.');
    });

    test('a .strict() violation (no specific field) gets the generic fallback message', async () => {
      enableFeature();
      const res = await post({ ...VALID_BODY, extra: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A non-empty "prompt" and "answer" are required.');
    });
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

    // Two calls were made and the second (render) is grounded in the answer, proving the pipeline threaded it through, not just the prompt.
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

describe('Phase E — request-level cache, exercised through the real shared app', () => {
  test('an identical repeat request is a cache hit: classify runs again, render does not', async () => {
    enableFeature();

    // First request: full miss, two calls (classify + render).
    const first = mockGeminiFetch([
      geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)),
      geminiSuccess(JSON.stringify(PROCESS_DATA)),
    ]);
    const res1 = await post(VALID_BODY);
    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ representation: 'process_diagram', data: PROCESS_DATA });
    expect(first.calls).toHaveLength(2);

    // A second identical request with only one response queued (for classify). If render() were called again, gemini.js
    // would repeat classify's response, which fails render validation; a real cache hit never gets that far.
    const second = mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    const res2 = await post(VALID_BODY);

    expect(res2.status).toBe(200);
    // Same representation and data; requestId is a fresh UUID per request by design, so it's excluded from the comparison.
    expect(res2.body.representation).toBe(res1.body.representation);
    expect(res2.body.data).toEqual(res1.body.data);
    // Exactly one call: classify still runs (caching wraps render() only); render() was skipped.
    expect(second.calls).toHaveLength(1);
  });

  test('a different answer on retry is a genuine miss, not a false hit', async () => {
    enableFeature();
    mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)), geminiSuccess(JSON.stringify(PROCESS_DATA))]);
    await post(VALID_BODY);

    const { calls } = mockGeminiFetch([
      geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)),
      geminiSuccess(JSON.stringify(PROCESS_DATA)),
    ]);
    const res = await post({ ...VALID_BODY, answer: 'A different answer to the same question.' });

    expect(res.status).toBe(200);
    // Both calls made again — grounding in the specific answer means a
    // changed answer can never be served from a stale cache entry.
    expect(calls).toHaveLength(2);
  });

  test('a cache hit still consumes the per-user daily budget', async () => {
    // The budget limit is read once at boot (index.js), not per request, so it can't be reconfigured via env mid-test like
    // the enabled/allow-list gates; inspect the counter directly, as budget.test.js does via peek().
    enableFeature();
    const budget = app.locals.learningRepresentationBudget;
    const before = budget.peek(fixtures.teacherA.id);

    mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS)), geminiSuccess(JSON.stringify(PROCESS_DATA))]);
    await post(VALID_BODY); // miss
    expect(budget.peek(fixtures.teacherA.id)).toBe(before + 1);

    mockGeminiFetch([geminiSuccess(JSON.stringify(HIGH_CONFIDENCE_PROCESS))]);
    const res2 = await post(VALID_BODY); // the cache hit
    expect(res2.body.representation).toBe('process_diagram');

    // Charged per request, not per Gemini call: the hit (one call, not two) still spent a full unit, per routes/learningRepresentation.js.
    expect(budget.peek(fixtures.teacherA.id)).toBe(before + 2);
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
