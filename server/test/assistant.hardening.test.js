// Milestone M9 — the cost and availability guards, end to end.
//
// The two new modules are unit-tested in test/assistant/budget.test.js and
// test/assistant/breaker.test.js. What is checked HERE is everything that only
// exists once they are WIRED: that the route reads them from app.locals, that
// an exhausted budget and an open breaker both spend NO model call, that both
// produce a passthrough rather than an error (G22), and — the point of the whole
// amendment — that an open router breaker leaves POST /api/coach working.
//
// ─── HOW THE GUARDS ARE DRIVEN ─────────────────────────────────────────────
// By replacing app.locals.assistantBudget / assistantBreaker for the duration of
// a test and restoring afterwards. That is not a workaround for an untestable
// design; it IS the design (approval A4) — the route resolves both per request
// from app.locals precisely so they can be constructed elsewhere. Exhausting the
// real 100-call budget over HTTP would be a slower test that proved less.
//
// ─── WHY THE LIMITER TEST BUILDS ITS OWN APP ───────────────────────────────
// The suite runs with fileParallelism: false and shares one required
// src/index.js per worker. Exhausting the shared app's limiter to see a 429
// would poison every test file that runs after this one. So the limiter case
// mounts the REAL factory (lib/limiters.js) on a throwaway Express app — which
// is exactly why that factory exists.

const express = require('express');
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited } = require('./helpers/geminiMock');
const { createBudgetCounter } = require('../src/assistant/budget');
const { createRouterBreaker, createDisabledBreaker } = require('../src/assistant/breaker');
const { createGenerateLimiter, GENERATE_LIMIT_DEFAULTS } = require('../src/lib/limiters');
const { classify } = require('../src/assistant/classifier');
const { GeminiService } = require('../src/gemini');
const { listForRole } = require('../src/actions/registry');

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
let savedBudget;
let savedEventBudget;
let savedBreaker;

function enableAssistant() {
  process.env.ASSISTANT_ENABLED = 'true';
  process.env.ASSISTANT_ACTION_GENERATE_ASSESSMENT = 'true';
  process.env.ASSISTANT_ACTION_OPEN_GENERATOR = 'true';
  process.env.ASSISTANT_ALLOWED_ROLES = 'teacher';
  delete process.env.ASSISTANT_ALLOWED_SCHOOL_CODES;
}

function clearAssistantEnv() {
  for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
}

function interpret(body) {
  return request(app)
    .post('/api/assistant/interpret')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send(body);
}

const GOOD_PROPOSAL = {
  intent: 'generate_assessment',
  confidence: 'high',
  slots: { format: 'worksheet', topic: 'fractions', grade: 'class 5' },
};
const proposalResponse = (proposal) => geminiSuccess(JSON.stringify(proposal));

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'assthard');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ASSISTANT_ENV_KEYS.map((k) => [k, process.env[k]]));
  savedBudget = app.locals.assistantBudget;
  savedEventBudget = app.locals.assistantEventBudget;
  savedBreaker = app.locals.assistantBreaker;
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // Restore the app's own guards, so nothing this file did is visible to any
  // test file that runs after it.
  app.locals.assistantBudget = savedBudget;
  app.locals.assistantEventBudget = savedEventBudget;
  app.locals.assistantBreaker = savedBreaker;
});

beforeEach(() => {
  clearAssistantEnv();
  vi.unstubAllGlobals();
  app.locals.assistantBudget = savedBudget;
  app.locals.assistantEventBudget = savedEventBudget;
  app.locals.assistantBreaker = savedBreaker;
});

// ---- the wiring itself ------------------------------------------------------

describe('the guards are wired', () => {
  test('the app constructs both and exposes them on app.locals', () => {
    // If either is missing, the route falls back to the pipeline's permissive
    // defaults and M9 silently does nothing — which would look exactly like a
    // passing suite.
    expect(typeof savedBudget.consume).toBe('function');
    expect(typeof savedBreaker.isOpen).toBe('function');
  });

  test('the real budget uses the configured daily limit', () => {
    expect(savedBudget.limit).toBe(100);
  });
});

// ---- per-user daily budget --------------------------------------------------

describe('per-user daily budget (pipeline stage 7)', () => {
  beforeEach(() => enableAssistant());

  test('routes normally while inside the budget', async () => {
    app.locals.assistantBudget = createBudgetCounter({ limit: 2 });
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(res.body.passthrough).toBe(false);
    expect(mock).toHaveBeenCalled();
  });

  test('falls through to the coach once the budget is spent', async () => {
    app.locals.assistantBudget = createBudgetCounter({ limit: 1 });
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const first = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(first.body.passthrough).toBe(false);

    const second = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(second.status).toBe(200);
    expect(second.body.passthrough).toBe(true);
    expect(second.body.reason).toBe('budget_exhausted');
    expect(second.body.actions).toEqual([]);
  });

  test('an exhausted budget spends NO model call', async () => {
    // The entire point of the control. A budget that still pays for the call it
    // refuses to use is not a cost control.
    app.locals.assistantBudget = createBudgetCounter({ limit: 0 });
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });

    expect(res.body.reason).toBe('budget_exhausted');
    expect(mock).not.toHaveBeenCalled();
  });

  test('exhaustion is a 200, never an error', async () => {
    app.locals.assistantBudget = createBudgetCounter({ limit: 0 });
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(res.status).toBe(200);
  });

  test('the budget is charged per user, not globally', async () => {
    const other = await loginAs(app, fixtures.schoolA, fixtures.teacherA2, fixtures.PASSWORD);
    app.locals.assistantBudget = createBudgetCounter({ limit: 1 });
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    await interpret({ utterance: 'make a class 5 fractions worksheet' });
    const exhausted = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(exhausted.body.reason).toBe('budget_exhausted');

    const otherTeacher = await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${other}`)
      .send({ utterance: 'make a class 5 fractions worksheet' });

    expect(otherTeacher.body.passthrough).toBe(false);
  });

  test('the budget is not consulted when the assistant is off', async () => {
    // With the flags off the rollout gate answers first, so a disabled feature
    // cannot quietly burn a teacher's daily allowance.
    clearAssistantEnv();
    const budget = createBudgetCounter({ limit: 5 });
    app.locals.assistantBudget = budget;

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });

    expect(res.body.reason).toBe('disabled');
    expect(budget.size()).toBe(0);
  });
});

// ---- the telemetry write bound (found by the M9 security review) ------------

describe('telemetry writes are bounded per user', () => {
  beforeEach(() => enableAssistant());

  function sendEvent() {
    return request(app)
      .post('/api/assistant/events')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        events: [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 6 }],
      });
  }

  async function assistantRowCount() {
    return prisma.event.count({
      where: { type: { in: ['assistant_prefill_delivered', 'assistant_prefill_outcome'] } },
    });
  }

  test('an over-budget batch is dropped, and writes no row', async () => {
    app.locals.assistantEventBudget = createBudgetCounter({ limit: 1 });

    const before = await assistantRowCount();
    expect((await sendEvent()).status).toBe(204);
    expect(await assistantRowCount()).toBe(before + 1);

    // Second request is over budget: still a 204 (telemetry never surfaces an
    // error to the teacher), but no row.
    expect((await sendEvent()).status).toBe(204);
    expect(await assistantRowCount()).toBe(before + 1);
  });

  test('the real budget is derived from the routing budget, not from a new flag', () => {
    // Two rows per routed session is the design ceiling, so twice the interpret
    // budget plus headroom cannot clip a legitimate teacher.
    expect(app.locals.assistantEventBudget.limit).toBe(savedBudget.limit * 2 + 20);
  });

  test('telemetry and routing draw on SEPARATE budgets', async () => {
    // Telemetry must never be able to consume the allowance a teacher needs for
    // actual routing.
    app.locals.assistantBudget = createBudgetCounter({ limit: 1 });
    app.locals.assistantEventBudget = createBudgetCounter({ limit: 5 });

    await sendEvent();
    await sendEvent();

    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);
    const routed = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(routed.body.passthrough).toBe(false);
  });
});

// ---- CHANGE-8: the router yields to the coach -------------------------------

describe('the router breaker (CHANGE-8)', () => {
  beforeEach(() => enableAssistant());

  /** A breaker already open, as if a 429 storm had just happened. */
  function openBreaker() {
    const breaker = createRouterBreaker({ threshold: 1, windowMs: 60_000, cooldownMs: 300_000 });
    breaker.recordRateLimited();
    return breaker;
  }

  test('an open breaker returns a passthrough and spends NO model call', async () => {
    app.locals.assistantBreaker = openBreaker();
    const { mock } = mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });

    expect(res.status).toBe(200);
    expect(res.body.passthrough).toBe(true);
    expect(res.body.actions).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  test('the open breaker reports an EXISTING passthrough reason (approval A3)', async () => {
    app.locals.assistantBreaker = openBreaker();
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });

    // No tenth reason was introduced: the wire vocabulary is frozen and mirrored
    // in the client's types.ts. `breakerOpen` on the decision log is what makes
    // this case diagnosable.
    expect(res.body.reason).toBe('classifier_error');
    const { PASSTHROUGH_REASONS } = require('../src/assistant/contracts');
    expect(PASSTHROUGH_REASONS).toContain(res.body.reason);
  });

  test('upstream 429s trip the breaker through the real endpoint', async () => {
    app.locals.assistantBreaker = createRouterBreaker({
      threshold: 2,
      windowMs: 60_000,
      cooldownMs: 300_000,
    });
    const { mock } = mockGeminiFetch([geminiRateLimited()]);

    // Two rate-limited routing attempts.
    await interpret({ utterance: 'make a class 5 fractions worksheet' });
    await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(mock).toHaveBeenCalled();
    expect(app.locals.assistantBreaker.isOpen()).toBe(true);

    // The third must not reach the upstream at all.
    const callsBefore = mock.mock.calls.length;
    const third = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(third.body.passthrough).toBe(true);
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test('a timeout does not trip the breaker', async () => {
    // Only genuine upstream rate limiting counts. Treating every failure as
    // quota pressure would make the router yield for reasons that have nothing
    // to do with the Coach's quota.
    app.locals.assistantBreaker = createRouterBreaker({
      threshold: 2,
      windowMs: 60_000,
      cooldownMs: 300_000,
    });
    mockGeminiFetch([{ reject: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }]);

    await interpret({ utterance: 'make a class 5 fractions worksheet' });
    await interpret({ utterance: 'make a class 5 fractions worksheet' });
    await interpret({ utterance: 'make a class 5 fractions worksheet' });

    expect(app.locals.assistantBreaker.isOpen()).toBe(false);
  });

  test('THE COACH KEEPS WORKING WHILE THE BREAKER IS OPEN', async () => {
    // Invariant I12, and the reason CHANGE-8 exists at all. If this ever fails,
    // the breaker has stopped protecting the thing it was built to protect and
    // has started being an outage.
    app.locals.assistantBreaker = openBreaker();
    const { mock } = mockGeminiFetch([geminiSuccess('Try think-pair-share for a large class.')]);

    const routed = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(routed.body.passthrough).toBe(true);
    expect(mock).not.toHaveBeenCalled();

    const coached = await request(app)
      .post('/api/coach')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ query: 'How do I keep a large class engaged?', context: {}, language: 'en' });

    expect(coached.status).toBe(200);
    expect(mock).toHaveBeenCalled();
  });

  test('a disabled breaker never interferes', async () => {
    app.locals.assistantBreaker = createDisabledBreaker();
    mockGeminiFetch([proposalResponse(GOOD_PROPOSAL)]);

    const res = await interpret({ utterance: 'make a class 5 fractions worksheet' });
    expect(res.body.passthrough).toBe(false);
  });
});

// ---- the signal the breaker depends on --------------------------------------

describe('the rateLimited signal reaches the pipeline', () => {
  test('a real GeminiService reports rateLimited on an upstream 429', async () => {
    // THE SEAM THE WHOLE BREAKER HANGS FROM. gemini.js is protected and is not
    // modified, so the breaker reads `metrics.rateLimited` off the error the
    // shared service already produces. If that field ever stopped being set, the
    // breaker would never open and every unit test above would still pass — this
    // is the case that would catch it.
    mockGeminiFetch([geminiRateLimited()]);

    const gemini = new GeminiService({
      apiKey: 'test-key',
      endpoint: 'https://example.invalid/generateContent',
      timeoutMs: 1000,
      totalTimeoutMs: 2000,
      maxRetries: 0,
      maxCallsPerRequest: 1,
      maxContinuations: 0,
      maxOutputTokens: 512,
    });

    const result = await classify({
      gemini,
      utterance: 'make a worksheet',
      descriptors: listForRole('teacher', {
        ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
        ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
      }),
      requestId: 'test-request',
    });

    expect(result.ok).toBe(false);
    expect(result.metrics.rateLimited).toBe(true);
  });

  test('a non-429 failure does NOT report rateLimited', async () => {
    mockGeminiFetch([{ status: 500, text: 'server error' }]);

    const gemini = new GeminiService({
      apiKey: 'test-key',
      endpoint: 'https://example.invalid/generateContent',
      timeoutMs: 1000,
      totalTimeoutMs: 2000,
      maxRetries: 0,
      maxCallsPerRequest: 1,
      maxContinuations: 0,
      maxOutputTokens: 512,
    });

    const result = await classify({
      gemini,
      utterance: 'make a worksheet',
      descriptors: listForRole('teacher', {
        ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
        ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
      }),
      requestId: 'test-request',
    });

    expect(result.ok).toBe(false);
    expect(Boolean(result.metrics.rateLimited)).toBe(false);
  });
});

// ---- the limiter on the generation endpoint ---------------------------------

describe('POST /api/resources/generate is rate limited', () => {
  test('the limiter is mounted on the real app', async () => {
    // Proven by the standard headers rather than by exhausting the bucket:
    // this app instance is shared with every other test file in the run.
    const res = await request(app)
      .post('/api/resources/generate')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({});

    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  test('the limiter does not change the endpoint while healthy', async () => {
    // No user-visible regression when limits are healthy: a malformed body is
    // still the same 400 it was before M9.
    const res = await request(app)
      .post('/api/resources/generate')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('other /api/resources paths are NOT limited by it', async () => {
    // The mount is on the generate path alone. If it ever widened to the whole
    // resources router, library browsing would start consuming a generation
    // budget.
    const listed = await request(app)
      .get('/api/resources')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(listed.status).toBe(200);
    expect(listed.headers['ratelimit-limit']).toBeUndefined();
  });

  test('it returns 429 with a readable message once exhausted', async () => {
    // On a THROWAWAY app built from the real factory, so the shared app's
    // bucket is untouched.
    const limited = express();
    limited.use(
      '/generate',
      createGenerateLimiter({ env: { RESOURCE_GENERATE_RATE_LIMIT_MAX: '2' }, isProduction: true, windowMinutes: 15 })
    );
    limited.post('/generate', (req, res) => res.json({ ok: true }));

    expect((await request(limited).post('/generate')).status).toBe(200);
    expect((await request(limited).post('/generate')).status).toBe(200);

    const blocked = await request(limited).post('/generate');
    expect(blocked.status).toBe(429);
    // The teacher reads a sentence, not a status code — client/src/api.ts
    // surfaces this string through the Generator's existing error region, which
    // is why no client change was needed.
    expect(blocked.body.error).toMatch(/wait a few minutes/i);
  });

  test('the non-production default is generous enough for the test suite', () => {
    // Load-bearing: resources.test.js drives this endpoint many times and is a
    // PROTECTED file that must pass unmodified. If a tighter default is ever
    // wanted, it belongs in production configuration — not here.
    expect(GENERATE_LIMIT_DEFAULTS.other).toBeGreaterThanOrEqual(600);
    expect(GENERATE_LIMIT_DEFAULTS.production).toBeLessThan(GENERATE_LIMIT_DEFAULTS.other);
  });
});
