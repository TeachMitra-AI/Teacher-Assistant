// Opens when Gemini is rate-limiting us, so the router steps aside and Coach keeps the shared quota.
// The signal is read from `error.metrics` rather than by changing gemini.js, and only the router
// consults the breaker, never /api/coach. Open means "skip the model call and pass through"; it is
// reported as `classifier_error`, with `breakerOpen` in the decision log, and never surfaces as an error.
// Built by a factory (not a singleton) so tests can't leak state; the eval runner injects a disabled one.

/**
 * Create a router breaker.
 *
 * Closed until `threshold` rate-limited classifications are observed inside
 * `windowMs`; then open for `cooldownMs`; then closed again, with the history
 * cleared so one stale event cannot re-trip it immediately.
 *
 * @param {object} options
 * @param {number} options.threshold rate-limited calls needed to open
 * @param {number} options.windowMs how far back those calls are counted
 * @param {number} options.cooldownMs how long the breaker stays open
 * @param {() => number} [options.now] injectable clock, so tests own time
 * @returns {{
 *   isOpen: () => boolean,
 *   recordRateLimited: () => void,
 *   recordSuccess: () => void,
 *   state: () => {open: boolean, recent: number, opensAt: number|null}
 * }}
 */
function createRouterBreaker({ threshold, windowMs, cooldownMs, now = Date.now } = {}) {
  /** Timestamps of recent rate-limited classifications, oldest first. */
  let rateLimitedAt = [];
  /** When the current open period ends; null when closed. */
  let openUntil = null;

  /** Drop events that have fallen out of the window. */
  function prune(at) {
    const cutoff = at - windowMs;
    if (rateLimitedAt.length > 0 && rateLimitedAt[0] <= cutoff) {
      rateLimitedAt = rateLimitedAt.filter((timestamp) => timestamp > cutoff);
    }
  }

  /**
   * Should the router skip the model call right now?
   * Also closes the breaker once the cooldown has elapsed, so no timer is needed.
   */
  function isOpen() {
    if (openUntil === null) return false;
    if (now() < openUntil) return true;

    // Clear the history too, otherwise one more 429 would re-open it immediately.
    openUntil = null;
    rateLimitedAt = [];
    return false;
  }

  /**
   * Record an upstream rate-limit on a classification. Timeouts, safety blocks and malformed
   * responses don't count; they say nothing about quota.
   */
  function recordRateLimited() {
    const at = now();
    if (openUntil !== null && at < openUntil) return; // already open; nothing to learn

    prune(at);
    rateLimitedAt.push(at);

    if (rateLimitedAt.length >= threshold) {
      openUntil = at + cooldownMs;
      rateLimitedAt = [];
    }
  }

  /**
   * Record a classification that reached the model. Doesn't clear the history: the window expires
   * events, and resetting on success would stop a half-failing storm from ever tripping.
   */
  function recordSuccess() {
    prune(now());
  }

  return {
    isOpen,
    recordRateLimited,
    recordSuccess,
    state: () => ({
      open: openUntil !== null && now() < openUntil,
      recent: rateLimitedAt.length,
      opensAt: openUntil,
    }),
  };
}

/** A breaker that never opens; the default for interpret() and the eval runner. */
function createDisabledBreaker() {
  return {
    isOpen: () => false,
    recordRateLimited: () => {},
    recordSuccess: () => {},
    state: () => ({ open: false, recent: 0, opensAt: null }),
  };
}

module.exports = { createRouterBreaker, createDisabledBreaker };
