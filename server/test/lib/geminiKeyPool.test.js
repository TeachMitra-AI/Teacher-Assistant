const { GeminiKeyPool } = require('../../src/lib/geminiKeyPool');
const { nextDailyResetAt } = require('../../src/lib/geminiPolicy');

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('GeminiKeyPool', () => {
  test('requires at least one key', () => {
    expect(() => new GeminiKeyPool([])).toThrow();
  });

  test('a single-key pool always returns that key', () => {
    const pool = new GeminiKeyPool(['only-key']);
    expect(pool.getKey()).toBe('only-key');
    expect(pool.getKey()).toBe('only-key');
  });

  test('round-robins across multiple available keys', () => {
    const pool = new GeminiKeyPool(['a', 'b', 'c']);
    expect(pool.getKey()).toBe('a');
    expect(pool.getKey()).toBe('b');
    expect(pool.getKey()).toBe('c');
    expect(pool.getKey()).toBe('a');
  });

  test('a rate-limited key is skipped until the next daily reset (12:30 PM IST by default)', () => {
    const clock = makeClock(0); // 1970-01-01T00:00:00Z = 05:30 IST
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
    expect(pool.getKey()).toBe('a');
    pool.reportFailure('a', { status: 429 });
    const resetAt = nextDailyResetAt(0);
    expect(pool.hasAvailableKey()).toBe(true);
    expect(pool.getKey()).toBe('b'); // 'a' is cooling down, 'b' is next/nearest
    expect(pool.getKey()).toBe('b'); // 'a' still cooling down

    clock.advance(resetAt - 1);
    expect(pool.getKey()).toBe('b'); // one ms before the reset, still cooling

    clock.advance(1);
    expect(pool.getKey()).toBe('a'); // reset time reached, back in rotation
  });

  test('two keys failing within the same reset window share the same recovery time', () => {
    // Unlike a rolling per-key cooldown, a fixed daily reset means every key
    // that fails before the boundary recovers AT THE SAME INSTANT — the next
    // occurrence of 12:30 PM IST — regardless of exactly when within that
    // window each one failed.
    const clock = makeClock(0);
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
    pool.reportFailure('a', { status: 429 });
    clock.advance(60 * 60 * 1000); // 1h later, still well before today's 12:30 IST reset
    pool.reportFailure('b', { status: 429 });
    expect(pool.nextAvailableAt()).toBe(nextDailyResetAt(0));
  });

  test('reportFailure honors an explicit retryAfterMs over the daily reset time', () => {
    // Gemini's own Retry-After is a specific instruction for THIS response
    // (e.g. a short per-minute rate limit) and wins over the much later
    // daily-reset fallback.
    const clock = makeClock(0);
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
    pool.reportFailure('a', { status: 429 }, { retryAfterMs: 5000 });
    clock.advance(4999);
    expect(pool.getKey()).toBe('b'); // 'a' still cooling down
    clock.advance(1);
    expect(pool.getKey()).toBe('a');
  });

  test('an auth (401/403) failure uses the duration-based auth cooldown, not the daily reset', () => {
    const clock = makeClock(0);
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now, authCooldownMs: 100000 });
    pool.reportFailure('a', { status: 401 });
    clock.advance(1000);
    expect(pool.getKey()).toBe('b'); // still well within the auth cooldown
    expect(pool.hasAvailableKey()).toBe(true);
  });

  test('network/timeout/5xx failures do not cool a key down', () => {
    const pool = new GeminiKeyPool(['a', 'b']);
    pool.reportFailure('a', { status: 500 });
    pool.reportFailure('a', { name: 'TimeoutError' });
    expect(pool.getKey()).toBe('a'); // never rotated away, still first in line
  });

  test('when every key is cooling down, getKey returns the one recovering soonest', () => {
    const clock = makeClock(0);
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
    pool.reportFailure('a', { status: 429 }, { retryAfterMs: 5000 });
    pool.reportFailure('b', { status: 429 }, { retryAfterMs: 2000 });
    expect(pool.hasAvailableKey()).toBe(false);
    expect(pool.getKey()).toBe('b'); // recovers sooner than 'a'
  });

  test('reportSuccess clears cooldown', () => {
    const clock = makeClock(0);
    const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
    pool.reportFailure('a', { status: 429 });
    expect(pool.hasAvailableKey()).toBe(true); // 'b' still free
    pool.reportSuccess('a');
    expect(pool.getKey()).toBe('a');
  });

  test('describe() never exposes a raw key', () => {
    const pool = new GeminiKeyPool(['super-secret-key-value']);
    const snapshot = JSON.stringify(pool.describe());
    expect(snapshot).not.toContain('super-secret-key-value');
    expect(pool.describe()[0].fingerprint).toBe('…alue');
  });

  describe('nextAvailableAt', () => {
    test('returns now() when a key is already free', () => {
      const clock = makeClock(1000);
      const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
      pool.reportFailure('a', { status: 429 });
      expect(pool.nextAvailableAt()).toBe(1000); // 'b' is still free
    });

    test('when every key is cooling down, returns the soonest cooldownUntil', () => {
      const clock = makeClock(0);
      const pool = new GeminiKeyPool(['a', 'b'], { now: clock.now });
      pool.reportFailure('a', { status: 429 }, { retryAfterMs: 5000 });
      pool.reportFailure('b', { status: 429 }, { retryAfterMs: 2000 });
      expect(pool.hasAvailableKey()).toBe(false);
      expect(pool.nextAvailableAt()).toBe(2000); // 'b' recovers first
    });

    test('with the daily-reset default, two keys exhausted on the same day recover together', () => {
      // The scenario from the original request (many keys, staggered
      // failures over hours) plays out differently under a FIXED daily reset
      // than under a rolling per-key cooldown: every key that fails before
      // the boundary shares the same recovery instant — see the "share the
      // same recovery time" test above for the detailed walkthrough.
      const clock = makeClock(0);
      const pool = new GeminiKeyPool(['key1', 'key20'], { now: clock.now });
      pool.reportFailure('key1', { status: 429 });
      clock.advance(60 * 60 * 1000);
      pool.reportFailure('key20', { status: 429 });
      expect(pool.nextAvailableAt()).toBe(nextDailyResetAt(0));
    });
  });
});
