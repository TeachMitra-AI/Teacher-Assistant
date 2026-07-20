const {
  parseRetryAfter,
  computeBackoffMs,
  classifyGeminiError,
} = require('../../src/lib/geminiPolicy');

describe('geminiPolicy.parseRetryAfter', () => {
  test('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfter('120')).toBe(120000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  test('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2020-01-01T00:00:00Z');
    const tenSecondsLater = 'Wed, 01 Jan 2020 00:00:10 GMT';
    expect(parseRetryAfter(tenSecondsLater, now)).toBe(10000);
  });

  test('an HTTP-date already in the past clamps to 0, never negative', () => {
    const now = Date.parse('2020-01-01T00:01:00Z');
    const earlier = 'Wed, 01 Jan 2020 00:00:00 GMT';
    expect(parseRetryAfter(earlier, now)).toBe(0);
  });

  test('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('not-a-date')).toBeNull();
  });
});

describe('geminiPolicy.computeBackoffMs', () => {
  test('grows exponentially with attempt when rng is fixed at its max', () => {
    const rng = () => 1; // full jitter picks the top of the range
    expect(computeBackoffMs(0, { baseMs: 500, capMs: 8000, rng })).toBe(500);
    expect(computeBackoffMs(1, { baseMs: 500, capMs: 8000, rng })).toBe(1000);
    expect(computeBackoffMs(2, { baseMs: 500, capMs: 8000, rng })).toBe(2000);
    expect(computeBackoffMs(3, { baseMs: 500, capMs: 8000, rng })).toBe(4000);
  });

  test('is capped at capMs', () => {
    const rng = () => 1;
    expect(computeBackoffMs(10, { baseMs: 500, capMs: 8000, rng })).toBe(8000);
  });

  test('full jitter keeps the value within [0, cappedBase]', () => {
    for (let i = 0; i < 100; i++) {
      const v = computeBackoffMs(2, { baseMs: 500, capMs: 8000 }); // real rng
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2000);
    }
  });

  test('rng of 0 yields 0 (jitter floor)', () => {
    expect(computeBackoffMs(3, { baseMs: 500, capMs: 8000, rng: () => 0 })).toBe(0);
  });

  test('Retry-After takes precedence over computed backoff', () => {
    const rng = () => 1;
    expect(computeBackoffMs(0, { baseMs: 500, capMs: 8000, retryAfterMs: 3000, rng })).toBe(3000);
  });

  test('Retry-After is still bounded by capMs', () => {
    expect(computeBackoffMs(0, { baseMs: 500, capMs: 8000, retryAfterMs: 999999 })).toBe(8000);
  });

  test('negative attempt is treated as attempt 0', () => {
    expect(computeBackoffMs(-5, { baseMs: 500, capMs: 8000, rng: () => 1 })).toBe(500);
  });
});

describe('geminiPolicy.classifyGeminiError', () => {
  test.each([
    ['429 rate limit', { status: 429 }, true, 'rate_limited'],
    ['500', { status: 500 }, true, 'upstream_5xx'],
    ['502', { status: 502 }, true, 'upstream_5xx'],
    ['503', { status: 503 }, true, 'upstream_5xx'],
    ['504', { status: 504 }, true, 'upstream_5xx'],
    ['408', { status: 408 }, true, 'upstream_5xx'],
    ['network (no status)', {}, true, 'network'],
    ['timeout by name', { name: 'TimeoutError' }, true, 'timeout'],
    ['abort by name', { name: 'AbortError' }, true, 'timeout'],
  ])('retriable: %s', (_label, err, retriable, reason) => {
    expect(classifyGeminiError(err)).toEqual({ retriable, reason });
  });

  test.each([
    ['400 invalid request', { status: 400 }, 'client_error'],
    ['401 auth', { status: 401 }, 'auth'],
    ['403 permission', { status: 403 }, 'auth'],
    ['404 config', { status: 404 }, 'client_error'],
    ['INPUT_BLOCKED', { code: 'INPUT_BLOCKED' }, 'safety_blocked'],
    ['OUTPUT_BLOCKED', { code: 'OUTPUT_BLOCKED' }, 'safety_blocked'],
  ])('NOT retriable: %s', (_label, err, reason) => {
    expect(classifyGeminiError(err)).toEqual({ retriable: false, reason });
  });

  test('a safety block with an incidental status is still never retried', () => {
    // Defensive: safety code must win even if a status is somehow attached.
    expect(classifyGeminiError({ code: 'OUTPUT_BLOCKED', status: 500 })).toEqual({
      retriable: false,
      reason: 'safety_blocked',
    });
  });

  test('null/undefined error is not retriable', () => {
    expect(classifyGeminiError(null)).toEqual({ retriable: false, reason: 'unknown' });
    expect(classifyGeminiError(undefined)).toEqual({ retriable: false, reason: 'unknown' });
  });
});
