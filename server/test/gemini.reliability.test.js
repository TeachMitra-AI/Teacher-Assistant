// Reliability + cost-control tests for GeminiService. Deterministic: a fake
// clock (`now`) plus a `sleep` that advances that clock lets us exercise the
// overall deadline and backoff timing WITHOUT any real waiting, and the
// injected `rng` makes jitter predictable. No real Gemini calls — fetch is
// either stubbed globally (mockGeminiFetch) or injected directly.
const { GeminiService } = require('../src/gemini');
const {
  mockGeminiFetch,
  toFetchResponse,
  geminiSuccess,
  geminiInputBlocked,
  geminiRateLimited,
} = require('./helpers/geminiMock');

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
      ['callsMade', 'continuations', 'correlationId', 'keyRotations', 'latencyMs', 'outcome', 'rateLimited', 'retries', 'safetyBlocked', 'timedOut'].sort()
    );
  });
});
