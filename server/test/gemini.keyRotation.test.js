// Integration tests: GeminiService driven by a real, multi-key GeminiKeyPool.
// Same deterministic-clock style as gemini.reliability.test.js — no real
// waiting, no real network calls.
const { GeminiService } = require('../src/gemini');
const { GeminiKeyPool } = require('../src/lib/geminiKeyPool');
const { nextDailyResetAt } = require('../src/lib/geminiPolicy');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited } = require('./helpers/geminiMock');

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

function makeService({ keys = ['key-a', 'key-b'], poolOpts = {}, clock = makeClock(0), ...overrides } = {}) {
  const sleeps = [];
  const keyPool = new GeminiKeyPool(keys, { now: clock.now, ...poolOpts });
  const service = new GeminiService({
    keyPool,
    endpoint: 'https://example.invalid/generate',
    timeoutMs: 5000,
    maxRetries: 3,
    maxCallsPerRequest: 8,
    totalTimeoutMs: 60000,
    maxContinuations: 4,
    now: clock.now,
    rng: () => 1,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { service, keyPool, clock, sleeps };
}

const ask = (service) => service.generateResponse({ query: 'A question', context: {}, language: 'en' });

function headerKeyFromCall(call) {
  return call.headers['x-goog-api-key'];
}

describe('GeminiService key rotation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a 429 on the first key switches to the next key immediately, with no backoff wait', async () => {
    const { mock, calls } = mockGeminiFetch([geminiRateLimited(), geminiSuccess('From key B.')]);
    const { service, sleeps } = makeService();

    const result = await ask(service);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(headerKeyFromCall(calls[0])).toBe('key-a');
    expect(headerKeyFromCall(calls[1])).toBe('key-b');
    expect(result.text).toBe('From key B.');
    expect(sleeps).toHaveLength(0); // no backoff delay — the switch was instant
    expect(result.metrics.keyRotations).toBe(1);
    expect(result.metrics.retries).toBe(0);
  });

  test('a 401 on the first key rotates to the next key and succeeds', async () => {
    const { mock, calls } = mockGeminiFetch([{ status: 401, text: 'invalid key' }, geminiSuccess('From key B.')]);
    const { service, sleeps } = makeService();

    const result = await ask(service);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(headerKeyFromCall(calls[1])).toBe('key-b');
    expect(result.text).toBe('From key B.');
    expect(sleeps).toHaveLength(0);
  });

  test('when every key is rate-limited, falls back to the existing backoff/budget-exhaustion path', async () => {
    const { mock } = mockGeminiFetch([geminiRateLimited()]); // always 429, for any key
    const { service } = makeService({ maxCallsPerRequest: 4, maxRetries: 10 });

    await expect(ask(service)).rejects.toMatchObject({ status: 429 });
    // Both keys get one immediate rotation attempt each (2 calls), then the
    // remaining budget (2 more calls) is spent on the normal backoff/retry
    // path since no key is available anymore.
    expect(mock).toHaveBeenCalledTimes(4);
  });

  test('a key becomes available again after its cooldown elapses and is used on a later request', async () => {
    const clock = makeClock(0);
    const { keyPool, service } = makeService({ clock });

    mockGeminiFetch([geminiRateLimited(), geminiSuccess('From key B.')]);
    await ask(service); // key-a fails and cools down, key-b serves this request

    clock.advance(nextDailyResetAt(0)); // key-a's cooldown elapses (next 12:30 PM IST)

    const { mock: mock2, calls: calls2 } = mockGeminiFetch([geminiSuccess('From key A again.')]);
    const result2 = await ask(service);

    expect(mock2).toHaveBeenCalledTimes(1);
    expect(headerKeyFromCall(calls2[0])).toBe('key-a');
    expect(result2.text).toBe('From key A again.');
    expect(keyPool.hasAvailableKey()).toBe(true);
  });

  test('when every key is exhausted, the thrown error carries retryAt — the soonest any key recovers', async () => {
    const clock = makeClock(0);
    // A budget of exactly 2 (= key count) means both keys get exactly one
    // attempt, then the budget itself stops things — no backoff/retry noise
    // to account for, so the recovery-time math stays simple to verify.
    const { keyPool, service } = makeService({ clock, maxCallsPerRequest: 2 });
    mockGeminiFetch([geminiRateLimited()]); // always 429

    const err = await ask(service).catch((e) => e);

    expect(err).toMatchObject({ status: 429 });
    expect(err.retryAt).toBe(nextDailyResetAt(0)); // both keys failed at t=0, so both recover at the next 12:30 PM IST
    expect(err.retryAt).toBe(keyPool.nextAvailableAt());
  });

  test('a single-key pool (backward compatibility) behaves exactly as before: no rotation possible', async () => {
    const { mock } = mockGeminiFetch([geminiRateLimited()]);
    const { service } = makeService({ keys: ['only-key'], maxCallsPerRequest: 3, maxRetries: 10 });

    await expect(ask(service)).rejects.toMatchObject({ status: 429 });
    // Same shape as the equivalent single-key test in gemini.reliability.test.js:
    // the call budget (3), not maxRetries, is the binding limit.
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
