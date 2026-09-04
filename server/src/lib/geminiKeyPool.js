// Multi-key failover for the Gemini API. A GeminiKeyPool holds one or more
// API keys and hands one out per call via getKey(), skipping any key that
// recently hit a rate-limit/quota (429) or auth (401/403) error and is still
// "cooling down". This lets GeminiService switch keys immediately when one
// is exhausted, instead of surfacing an error to the teacher, while a
// single-key pool behaves exactly like a fixed key always did.
//
// Deliberately synchronous and dependency-free (like geminiPolicy.js) so it
// composes cleanly with gemini.js's own retry loop rather than introducing a
// second async control flow. `now` is injectable for deterministic tests.

const { classifyGeminiError, nextDailyResetAt } = require('./geminiPolicy');

class GeminiKeyPool {
  /**
   * @param {string[]} keys one or more API keys, in the order given.
   * @param {object} [opts]
   * @param {number} [opts.resetHourIst=12] hour (IST, 24h clock) a
   *   rate-limited/quota-exhausted key resets at, matching Gemini's own
   *   fixed daily quota reset rather than N hours after each failure.
   * @param {number} [opts.resetMinuteIst=30] minute component of the above.
   *   Default 12:30 PM IST.
   * @param {number} [opts.authCooldownMs=3600000] cooldown after an auth
   *   (401/403) failure — a distinct failure mode from quota exhaustion
   *   (a bad/revoked key), so it stays duration-based rather than tied to
   *   the daily reset.
   * @param {() => number} [opts.now=Date.now]
   */
  constructor(keys, opts = {}) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error('GeminiKeyPool requires at least one API key');
    }
    this.keys = keys;
    this.resetHourIst = opts.resetHourIst ?? 12;
    this.resetMinuteIst = opts.resetMinuteIst ?? 30;
    this.authCooldownMs = opts.authCooldownMs ?? 3600000;
    this.now = opts.now ?? (() => Date.now());
    this.cursor = 0; // round-robin pointer into this.keys
    this.state = new Map(keys.map((key) => [key, { cooldownUntil: 0 }]));
  }

  size() {
    return this.keys.length;
  }

  isAvailable(key) {
    return this.state.get(key).cooldownUntil <= this.now();
  }

  hasAvailableKey() {
    return this.keys.some((key) => this.isAvailable(key));
  }

  /**
   * Returns the next usable key, continuing round-robin from wherever the
   * last call left off (so the key right after a failed one is tried next —
   * the "nearest" available key), skipping anything still cooling down. If
   * every key is currently cooling down, returns whichever recovers soonest;
   * the caller's existing backoff/retry logic is the backstop for that case.
   */
  getKey() {
    const n = this.keys.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const key = this.keys[idx];
      if (this.isAvailable(key)) {
        this.cursor = (idx + 1) % n;
        return key;
      }
    }
    let soonest = this.keys[0];
    for (const key of this.keys) {
      if (this.state.get(key).cooldownUntil < this.state.get(soonest).cooldownUntil) soonest = key;
    }
    return soonest;
  }

  /**
   * Record a failed call for `key`. Only rate-limit and auth failures put
   * the key in cooldown — network/timeout/5xx errors aren't key-specific
   * problems, so they don't affect rotation.
   * @param {string} key
   * @param {object} error same shape classifyGeminiError expects
   * @param {{retryAfterMs?: number|null}} [opts] `retryAfterMs`, when Gemini
   *   sends an explicit Retry-After, still wins over the daily reset time —
   *   it's a more specific, authoritative instruction for THIS response.
   */
  reportFailure(key, error, opts = {}) {
    const state = this.state.get(key);
    if (!state) return;
    const { reason } = classifyGeminiError(error);
    if (reason === 'rate_limited') {
      state.cooldownUntil = opts.retryAfterMs != null
        ? this.now() + opts.retryAfterMs
        : nextDailyResetAt(this.now(), { hour: this.resetHourIst, minute: this.resetMinuteIst });
    } else if (reason === 'auth') {
      state.cooldownUntil = this.now() + this.authCooldownMs;
    }
  }

  /** Clears any cooldown for `key` after a successful call. */
  reportSuccess(key) {
    const state = this.state.get(key);
    if (state) state.cooldownUntil = 0;
  }

  /**
   * Timestamp (ms) at which the soonest-recovering key becomes available.
   * Returns now() immediately if a key is already free.
   */
  nextAvailableAt() {
    if (this.hasAvailableKey()) return this.now();
    return Math.min(...this.keys.map((key) => this.state.get(key).cooldownUntil));
  }

  /** Redacted status snapshot for logs/debugging — never the raw key. */
  describe() {
    const now = this.now();
    return this.keys.map((key) => {
      const state = this.state.get(key);
      return {
        fingerprint: key.length > 4 ? `…${key.slice(-4)}` : '…',
        coolingDown: state.cooldownUntil > now,
        cooldownUntil: state.cooldownUntil,
      };
    });
  }
}

module.exports = { GeminiKeyPool };
