// Route-level reliability tests: the REAL POST /api/coach path (auth,
// validation, the module-singleton GeminiService built from test env, error
// mapping, requestId/code contract) with only Gemini's fetch mocked. The
// deep budget/deadline/backoff mechanics are covered deterministically in
// gemini.reliability.test.js; this file verifies the wiring + client-facing
// error contract. testEnv sets LLM_MAX_RETRIES=1 and small timeouts so these
// stay fast.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited, geminiInputBlocked } = require('./helpers/geminiMock');

describe('coach reliability — route contract', () => {
  let fx;
  let token;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'coachrel');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function coach(body) {
    return request(app).post('/api/coach').set('Authorization', `Bearer ${token}`).send(body);
  }

  const validBody = { query: 'How do I keep a large class engaged?', context: {}, language: 'en' };

  test('successful response includes a requestId (correlation id)', async () => {
    mockGeminiFetch([geminiSuccess('Some engagement strategies...')]);
    const res = await coach(validBody);
    expect(res.status).toBe(200);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
    // Internal metrics must NOT leak into the client response.
    expect(res.body.metrics).toBeUndefined();
  });

  test('a transient 429 then success is transparent to the teacher (200)', async () => {
    mockGeminiFetch([geminiRateLimited(), geminiSuccess('Recovered answer.')]);
    const res = await coach(validBody);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Recovered answer.');
  });

  test('exhausted rate limiting returns 429 with RATE_LIMITED code and requestId, no raw error', async () => {
    mockGeminiFetch([geminiRateLimited()]); // always 429
    const res = await coach(validBody);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.requestId).toBeTruthy();
    expect(res.body.error).toMatch(/busy/i);
    expect(JSON.stringify(res.body)).not.toMatch(/rate limit exceeded/); // raw upstream text not leaked
  });

  test('repeated upstream 5xx returns a generic 502 with UPSTREAM_UNAVAILABLE code', async () => {
    mockGeminiFetch([{ status: 503, text: 'internal upstream detail' }]);
    const res = await coach(validBody);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/internal upstream detail/);
  });

  test('a non-retryable upstream auth error maps to 502 UPSTREAM_AUTH', async () => {
    mockGeminiFetch([{ status: 403, text: 'permission denied' }]);
    const res = await coach(validBody);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_AUTH');
  });

  test('a persistent timeout maps to 504 TIMEOUT', async () => {
    const timeoutErr = Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' });
    mockGeminiFetch([{ reject: timeoutErr }]);
    const res = await coach(validBody);
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('TIMEOUT');
    expect(res.body.requestId).toBeTruthy();
  });

  test('a safety-blocked input maps to 422 SAFETY_BLOCKED (unchanged status, now with code)', async () => {
    mockGeminiFetch([geminiInputBlocked('SAFETY')]);
    const res = await coach(validBody);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SAFETY_BLOCKED');
    expect(res.body.error).toMatch(/couldn't be processed/i);
  });

  test('validation errors also carry a requestId', async () => {
    const res = await coach({ query: '', context: {}, language: 'en' });
    expect(res.status).toBe(400);
    expect(res.body.requestId).toBeTruthy();
  });

  test('a notable reliability incident (exhausted 429) is recorded as an Event, metadata-only', async () => {
    mockGeminiFetch([geminiRateLimited()]);
    const res = await coach(validBody);
    expect(res.status).toBe(429);

    const events = await prisma.event.findMany({
      where: { userId: fx.teacherA.id, type: 'ai_rate_limit_exhausted' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events).toHaveLength(1);
    const metadata = JSON.parse(events[0].metadata);
    expect(metadata.requestId).toBe(res.body.requestId);
    expect(metadata.status).toBe(429);
    // No prompt/response text stored in the reliability event.
    expect(JSON.stringify(metadata)).not.toContain('large class');
  });
});
