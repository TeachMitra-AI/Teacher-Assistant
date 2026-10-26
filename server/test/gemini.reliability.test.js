// Reliability and cost-control tests for GeminiService. Deterministic: a fake clock (`now`) and a `sleep` that advances
// it exercise the deadline and backoff timing without real waiting, and the injected `rng` makes jitter predictable.
// No real Gemini calls: fetch is stubbed globally (mockGeminiFetch) or injected.
const { GeminiService } = require('../src/gemini');
const {
  mockGeminiFetch,
  toFetchResponse,
  geminiSuccess,
  geminiInputBlocked,
  geminiRateLimited,
} = require('./helpers/geminiMock');
const { SAFE_FALLBACK_MESSAGE } = require('../src/safety/outputGuard');

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// Builds a service with deterministic seams. `sleep` advances the fake clock
// by the requested delay so backoff genuinely consumes the deadline budget.
function makeService(overrides = {}) {
  const clock = overrides.clock || makeClock(0);
  const sleeps = [];
  const service = new GeminiService({
    apiKey: 'test-fake-key',
    endpoint: 'https://example.invalid/generate',
    timeoutMs: 5000,
    maxRetries: 3,
    maxCallsPerRequest: 8,
    totalTimeoutMs: 60000,
    maxContinuations: 4,
    now: clock.now,
    rng: () => 1, // full jitter picks the top of the range → predictable
    sleep: (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { service, clock, sleeps };
}

const ask = (service) => service.generateResponse({ query: 'A question', context: {}, language: 'en' });

describe('GeminiService reliability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a successful request makes exactly one Gemini call', async () => {
    const { mock } = mockGeminiFetch([geminiSuccess('An answer.')]);
    const { service } = makeService();
    const result = await ask(service);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.metrics.callsMade).toBe(1);
    expect(result.metrics.retries).toBe(0);
    expect(result.metrics.outcome).toBe('success');
  });

  test('a 429 followed by success retries once and succeeds', async () => {
    const { mock } = mockGeminiFetch([geminiRateLimited(), geminiSuccess('Recovered.')]);
    const { service } = makeService();
    const result = await ask(service);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Recovered.');
    expect(result.metrics.retries).toBe(1);
    expect(result.metrics.rateLimited).toBe(true);
  });

  test('honors Retry-After on a 429 (waits the header value, not computed backoff)', async () => {
    mockGeminiFetch([geminiRateLimited(2), geminiSuccess('Recovered after waiting.')]);
    const { service, sleeps } = makeService();
    const result = await ask(service);
    expect(sleeps).toContain(2000); // 2 seconds from the Retry-After header
    expect(result.text).toBe('Recovered after waiting.');
  });

  test('repeated 429 until the retry/call budget is exhausted throws a 429', async () => {
    const { mock } = mockGeminiFetch([geminiRateLimited()]); // always 429
    const { service } = makeService({ maxCallsPerRequest: 3, maxRetries: 10 });
    await expect(ask(service)).rejects.toMatchObject({ status: 429 });
    // Budget (3) is the binding limit, not maxRetries (10).
    expect(mock).toHaveBeenCalledTimes(3);
  });

  test('a temporary 5xx followed by success recovers', async () => {
    const { mock } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('OK now.')]);
    const { service } = makeService();
    const result = await ask(service);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('OK now.');
  });

  test('repeated 5xx exhausts retries and throws the upstream status', async () => {
    const { mock } = mockGeminiFetch([{ status: 500, text: 'boom' }]);
    const { service } = makeService({ maxRetries: 2, maxCallsPerRequest: 8 });
    await expect(ask(service)).rejects.toMatchObject({ status: 500 });
    expect(mock).toHaveBeenCalledTimes(3); // 1 + 2 retries (retries bind before budget of 8)
  });

  test('a non-retryable 4xx is not retried', async () => {
    const { mock } = mockGeminiFetch([{ status: 400, text: 'bad request' }]);
    const { service } = makeService();
    await expect(ask(service)).rejects.toMatchObject({ status: 400 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('a 401 (auth) is not retried', async () => {
    const { mock } = mockGeminiFetch([{ status: 401, text: 'unauthorized' }]);
    const { service } = makeService();
    await expect(ask(service)).rejects.toMatchObject({ status: 401 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('a network error (no status) is retried within budget', async () => {
    const netErr = new Error('socket hang up');
    const { mock } = mockGeminiFetch([{ reject: netErr }]);
    const { service } = makeService({ maxRetries: 2 });
    await expect(ask(service)).rejects.toThrow('socket hang up');
    expect(mock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  test('a per-call timeout is retried and flagged, then surfaces', async () => {
    const timeoutErr = Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' });
    const { mock } = mockGeminiFetch([{ reject: timeoutErr }]);
    const { service } = makeService({ maxRetries: 1 });
    await expect(ask(service)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(mock).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  test('the overall deadline stops further continuation calls', async () => {
    const clock = makeClock(0);
    // Each call takes 400ms of fake time; deadline is 1000ms.
    const fetchImpl = async () => {
      clock.advance(400);
      return toFetchResponse(geminiSuccess('part', 'MAX_TOKENS'));
    };
    const { service } = makeService({
      clock,
      fetchImpl,
      totalTimeoutMs: 1000,
      maxContinuations: 10,
      maxCallsPerRequest: 20,
    });
    const result = await ask(service);
    // call1 → t=400, cont call2 → t=800, cont call3 → t=1200 ≥ deadline → stop.
    expect(result.metrics.callsMade).toBe(3);
    expect(clock.now()).toBeGreaterThanOrEqual(1000);
  });

  test('the overall deadline stops retrying when backoff would exceed it', async () => {
    const { mock } = mockGeminiFetch([{ status: 500, text: 'boom' }]);
    // deadline 1000ms; rng=1 so backoff is 500 (attempt0) then 1000 (attempt1).
    const { service } = makeService({ totalTimeoutMs: 1000, maxRetries: 10, maxCallsPerRequest: 20 });
    await expect(ask(service)).rejects.toMatchObject({ status: 500 });
    // call1 → backoff 500 (t=500) → call2 → next backoff 1000 ≥ remaining 500 → give up.
    expect(mock).toHaveBeenCalledTimes(2);
  });

  test('the shared call budget caps total fetches even with many continuations available', async () => {
    // Always MAX_TOKENS → would continue forever if unbounded.
    const { mock } = mockGeminiFetch([geminiSuccess('more', 'MAX_TOKENS')]);
    const { service } = makeService({ maxCallsPerRequest: 5, maxContinuations: 50 });
    const result = await ask(service);
    expect(mock).toHaveBeenCalledTimes(5); // never exceeds the budget
    expect(result.metrics.callsMade).toBe(5);
  });

  test('the continuation limit caps continuations below the call budget', async () => {
    const { mock } = mockGeminiFetch([geminiSuccess('more', 'MAX_TOKENS')]);
    const { service } = makeService({ maxContinuations: 2, maxCallsPerRequest: 20 });
    await ask(service);
    expect(mock).toHaveBeenCalledTimes(3); // 1 initial + 2 continuations
  });

  test('a retry INSIDE a continuation still draws from the SAME shared budget', async () => {
    // Initial succeeds (MAX_TOKENS); the continuation then keeps hitting 5xx,
    // and its retries must consume the shared budget rather than a fresh one.
    const { mock } = mockGeminiFetch([geminiSuccess('start', 'MAX_TOKENS'), { status: 500, text: 'boom' }]);
    const { service } = makeService({ maxCallsPerRequest: 4, maxContinuations: 5, maxRetries: 10 });
    const result = await ask(service);
    // 1 initial + up to 3 more (continuation attempt + its retries) = 4 total,
    // never more. Continuation failures are swallowed → partial answer kept.
    expect(mock).toHaveBeenCalledTimes(4);
    expect(result.metrics.callsMade).toBe(4);
    expect(result.text).toContain('start');
  });

  test('the cumulative output cap stops continuations even when budget + finishReason allow more', async () => {
    const huge = 'x'.repeat(13000); // already beyond MAX_OUTPUT_LENGTH (12000)
    const { mock } = mockGeminiFetch([
      { status: 200, json: { candidates: [{ content: { parts: [{ text: huge }] }, finishReason: 'MAX_TOKENS' }] } },
      geminiSuccess('should not be requested', 'MAX_TOKENS'),
    ]);
    const { service } = makeService({ maxCallsPerRequest: 20, maxContinuations: 10 });
    await ask(service);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('a safety-blocked input is never retried', async () => {
    const { mock } = mockGeminiFetch([geminiInputBlocked('SAFETY')]);
    const { service } = makeService({ maxRetries: 5 });
    await expect(ask(service)).rejects.toMatchObject({ code: 'INPUT_BLOCKED' });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('metrics are attached to a thrown error for observability', async () => {
    mockGeminiFetch([{ status: 500, text: 'boom' }]);
    const { service } = makeService({ maxRetries: 1, maxCallsPerRequest: 8 });
    await ask(service).catch((err) => {
      expect(err.metrics).toBeDefined();
      expect(err.metrics.callsMade).toBe(2);
      expect(err.metrics.retries).toBe(1);
      expect(err.metrics.outcome).toBe('upstream_5xx');
    });
    expect.assertions(4);
  });

  test('never logs prompt/response text in metrics (metadata only)', async () => {
    mockGeminiFetch([geminiSuccess('secret answer text')]);
    const { service } = makeService();
    const result = await ask(service);
    const metricsJson = JSON.stringify(result.metrics);
    expect(metricsJson).not.toContain('secret answer text');
    expect(metricsJson).not.toContain('A question');
    // Only metadata keys are present.
    expect(Object.keys(result.metrics).sort()).toEqual(
      ['callsMade', 'continuations', 'correlationId', 'fallbackUsed', 'keyRotations', 'latencyMs', 'outcome', 'rateLimited', 'retries', 'safetyBlocked', 'timedOut'].sort()
    );
  });
});

// Coach-only fallback model (GEMINI_FALLBACK_ENDPOINT): a 5xx or timeout on the primary moves the rest of the request to
// the fallback, inside the same budget and deadline. Fake URLs only; none contain "flash-lite" (see classroomModeOn.test.js).
describe('GeminiService reliability — fallback model', () => {
  const PRIMARY = 'https://example.invalid/generate';
  const FALLBACK = 'https://example.invalid/fallback';
  const timeoutErr = () => Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a 503 on the primary retries on the fallback and succeeds', async () => {
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('From the fallback.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, FALLBACK]);
    expect(result.text).toBe('From the fallback.');
    expect(result.metrics.fallbackUsed).toBe(true);
  });

  test('a per-call timeout on the primary retries on the fallback', async () => {
    const { calls } = mockGeminiFetch([{ reject: timeoutErr() }, geminiSuccess('From the fallback.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, FALLBACK]);
    expect(result.metrics.timedOut).toBe(true);
    expect(result.metrics.fallbackUsed).toBe(true);
  });

  test('without a fallback configured, every retry stays on the primary (unchanged behaviour)', async () => {
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('OK now.')]);
    const { service } = makeService();
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, PRIMARY]);
    expect(result.metrics.fallbackUsed).toBe(false);
  });

  test('a 429 retries on the primary, never the fallback', async () => {
    const { calls } = mockGeminiFetch([geminiRateLimited(), geminiSuccess('Recovered.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, PRIMARY]);
    expect(result.metrics.fallbackUsed).toBe(false);
  });

  test.each([400, 401, 404])('a %i is not retried and never reaches the fallback', async (status) => {
    const { calls } = mockGeminiFetch([{ status, text: 'no' }]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    await expect(ask(service)).rejects.toMatchObject({ status });
    expect(calls.map((c) => c.url)).toEqual([PRIMARY]);
  });

  test('a network error (no status) retries on the primary', async () => {
    const { calls } = mockGeminiFetch([{ reject: new Error('socket hang up') }, geminiSuccess('OK now.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, PRIMARY]);
    expect(result.metrics.fallbackUsed).toBe(false);
  });

  test('once switched, continuations also go to the fallback', async () => {
    const { calls } = mockGeminiFetch([
      { status: 503, text: 'unavailable' },
      geminiSuccess('The first part', 'MAX_TOKENS'),
      geminiSuccess('and the rest.'),
    ]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, FALLBACK, FALLBACK]);
    expect(calls[2].body.systemInstruction.parts[0].text).toContain('CONTINUATION TASK');
    expect(result.text).toBe('The first part and the rest.');
  });

  test('fallback attempts draw from the same call budget', async () => {
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK, maxCallsPerRequest: 2, maxRetries: 5 });
    await expect(ask(service)).rejects.toMatchObject({ status: 503 });
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, FALLBACK]);
  });

  // fallbackUsed means a call actually went to the fallback, not that a switch was decided: with no retry left, it stays false.
  test.each([
    ['no retries allowed', { maxRetries: 0 }, { status: 503, text: 'unavailable' }, { status: 503 }],
    ['the call budget already spent', { maxRetries: 3, maxCallsPerRequest: 1 }, { status: 503, text: 'unavailable' }, { status: 503 }],
    ['a timeout with no retries allowed', { maxRetries: 0 }, { reject: timeoutErr() }, { name: 'TimeoutError' }],
  ])('fallbackUsed stays false when the request ends before any fallback call (%s)', async (_label, overrides, response, expected) => {
    const { calls } = mockGeminiFetch([response]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK, ...overrides });
    const err = await ask(service).catch((e) => e);
    expect(err).toMatchObject(expected);
    expect(calls.map((c) => c.url)).toEqual([PRIMARY]);
    expect(err.metrics.fallbackUsed).toBe(false);
  });

  test('the overall deadline still stops fallback retries', async () => {
    const { calls } = mockGeminiFetch([{ status: 500, text: 'boom' }]);
    // As in the deadline test above: backoff 500 then 1000 against a 1000ms deadline allows exactly two calls.
    const { service } = makeService({ fallbackEndpoint: FALLBACK, totalTimeoutMs: 1000, maxRetries: 10, maxCallsPerRequest: 20 });
    await expect(ask(service)).rejects.toMatchObject({ status: 500 });
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, FALLBACK]);
  });

  test('the fallback receives exactly the same request body (same systemInstruction / contents split)', async () => {
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('OK.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    await ask(service);
    expect(calls[1].body).toEqual(calls[0].body);
    expect(calls[1].body.contents.at(-1).parts[0].text).toContain('A question');
    expect(calls[1].body.systemInstruction.parts[0].text).not.toContain('A question');
  });

  test('a fallback answer that echoes the system instruction is still suppressed', async () => {
    const leaked =
      'Sure! You are an expert educational coach for Indian government school teachers. Provide DETAILED, GRADE-SPECIFIC, ACTIONABLE guidance.';
    mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess(leaked)]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    expect(result.suppressed).toBe(true);
    expect(result.text).toBe(SAFE_FALLBACK_MESSAGE);
  });

  test('generateContent (resources, lesson plans, attachments) never uses the fallback', async () => {
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('OK.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await service.generateContent({ systemInstruction: 'Trusted.', userText: 'Untrusted.' });
    expect(calls.map((c) => c.url)).toEqual([PRIMARY, PRIMARY]);
    expect(result.metrics.fallbackUsed).toBe(false);
  });

  test('a teacher cancelling during a primary call stops the request without trying the fallback', async () => {
    const controller = new AbortController();
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const { service } = makeService({ fallbackEndpoint: FALLBACK, fetchImpl });
    await expect(
      service.generateResponse({ query: 'A question', context: {}, language: 'en' }, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CLIENT_ABORTED' });
    expect(urls).toEqual([PRIMARY]);
  });

  test('metrics record the switch but never the endpoint URL or key', async () => {
    mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('OK.')]);
    const { service } = makeService({ fallbackEndpoint: FALLBACK });
    const result = await ask(service);
    const metricsJson = JSON.stringify(result.metrics);
    expect(result.metrics.fallbackUsed).toBe(true);
    expect(metricsJson).not.toContain('example.invalid');
    expect(metricsJson).not.toContain('test-fake-key');
  });
});
