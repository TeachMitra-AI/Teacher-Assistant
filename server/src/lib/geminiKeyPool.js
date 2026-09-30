// Multi-key failover for Gemini. getKey() hands out one key per call, skipping keys cooling down after a
// rate-limit/quota (429) or auth (401/403) error, so GeminiService can switch keys instead of surfacing an error.
// A single-key pool behaves like a fixed key. Synchronous and dependency-free (like geminiPolicy.js) so it fits
// gemini.js's retry loop; `now` is injectable for tests.

const { classifyGeminiError, nextDailyResetAt } = require('./geminiPolicy');

class GeminiKeyPool {
  /**
   * @param {string[]} keys one or more API keys, in the order given.
   * @param {object} [opts]
   * @param {number} [opts.resetHourIst=12] hour (IST, 24h) a rate-limited key resets at, matching Gemini's
   *   fixed daily quota reset rather than N hours after each failure.
   * @param {number} [opts.resetMinuteIst=30] minute component of the above (default 12:30 PM IST).
   * @param {number} [opts.authCooldownMs=3600000] cooldown after an auth failure, a bad or revoked key,
   *   so it's duration-based rather than tied to the daily reset.
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
   * Returns the next usable key, round-robin from where the last call left off, skipping keys still cooling down.
   * If all are cooling down it returns whichever recovers soonest; gemini.js's backoff is the backstop.
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
   * Record a failed call for `key`. Only rate-limit and auth failures start a cooldown; network, timeout and 5xx
   * aren't key-specific.
   * @param {string} key
   * @param {object} error same shape classifyGeminiError expects
   * @param {{retryAfterMs?: number|null}} [opts] an explicit Retry-After wins over the daily reset time
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

  /** Timestamp (ms) when the soonest-recovering key is available; now() if one is already free. */
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
