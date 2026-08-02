// The router-yields-to-Coach breaker — amendment CHANGE-8 (Milestone M9).
//
// ─── THE ONE SENTENCE THAT EXPLAINS THIS FILE ──────────────────────────────
// When the upstream is rate-limiting us, COACHING WINS.
//
// The Coach and the router draw on the same Gemini quota. Coaching is the
// product; routing is a convenience that saves a teacher some clicks. Without
// arbitration, an upstream 429 storm degrades both at once — the router keeps
// spending calls on classifications that will fail, and each of those calls is
// one the Coach could have used to answer a question. This breaker makes the
// optional feature step back so the core one keeps working (invariant I12,
// decision D20).
//
// That risk is not hypothetical. During M7b two eval runs died on upstream
// limits, the second returning HTTP 429 on 126 consecutive calls. The same event
// during a rollout, with no breaker, is a school losing its coaching answers to
// worksheet routing.
//
// ─── WHAT IT WATCHES, AND HOW IT AVOIDS TOUCHING gemini.js ─────────────────
// gemini.js already records rate limiting on its per-request tracker
// (`tracker.rateLimited`, set when it classifies an upstream failure as
// rate_limited) and attaches that snapshot to the error it throws as
// `error.metrics`. classifier.js already passes those metrics back untouched. So
// the signal is read from OUTSIDE the shared service: gemini.js is protected
// (G21) and is not opened, and classifier.js — which is documented as the file
// that talks to Gemini and makes no decisions — gains no decision.
//
// ─── SCOPE: THE ROUTER ONLY ────────────────────────────────────────────────
// This breaker is constructed once and injected into the interpret pipeline. It
// is never consulted by POST /api/coach. That asymmetry IS the amendment; a
// breaker that gated both would protect the quota and defeat the purpose.
//
// ─── FAILURE POSTURE ───────────────────────────────────────────────────────
// Open means "skip the model call and return a passthrough" — a normal coaching
// answer, arriving faster than usual. It is never an error, never surfaced, and
// never a 5xx (G22).
//
// The passthrough reason reported while open is the EXISTING `classifier_error`
// (approval A3), whose frozen definition is already "upstream failure, malformed
// response, network". A tenth reason was considered and rejected: the vocabulary
// is frozen in contracts.js, mirrored in the client's types.ts, and guarded
// against drift, so adding one buys a two-sided coordinated change to describe
// something the teacher can never tell apart. The distinguishing detail goes to
// the decision log as `breakerOpen`, where it is actionable.
//
// ─── WHY IT IS A FACTORY (approval A4) ─────────────────────────────────────
// Same reason as budget.js: module-level mutable state would leak between test
// files under fileParallelism: false, and a breaker left open by one test would
// fail an unrelated one. The eval runner also injects its own disabled breaker
// (approval A6) so a quota-pressured run measures routing quality rather than
// infrastructure state — the M7a lesson that infrastructure must never be scored
// as model quality.

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
   *
   * Also performs the close transition, so no timer is needed: the breaker is
   * evaluated on the request path and re-closes on the first request after the
   * cooldown elapses. A background timer would keep a Node handle alive for a
   * state change nobody is waiting for.
   */
  function isOpen() {
    if (openUntil === null) return false;
    if (now() < openUntil) return true;

    // Cooldown elapsed. Clear the history as well as the flag: keeping it would
    // let a single further 429 re-open the breaker immediately, because the old
    // events would still be sitting at the threshold.
    openUntil = null;
    rateLimitedAt = [];
    return false;
  }

  /**
   * Record that a classification failed because the upstream rate-limited us.
   *
   * Called only for genuine upstream rate limiting — not for timeouts, safety
   * blocks or malformed responses. Those are ordinary routing failures that the
   * pipeline already degrades correctly, and counting them here would open the
   * breaker for reasons that have nothing to do with quota.
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
   * Record a classification that reached the model successfully.
   *
   * Deliberately does NOT clear the history. The window is what expires events;
   * letting one success reset the count would mean a storm that is failing half
   * the time — precisely the case worth reacting to — never trips the breaker.
   * It exists so the pipeline can report every outcome to one object rather than
   * branching on which outcomes are interesting.
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

/**
 * A breaker that is permanently closed.
 *
 * The default injected into interpret(), and the one the eval runner uses
 * (approval A6). Written as an object rather than as `undefined` checks so that
 * the pipeline has exactly one code path whether or not a real breaker was
 * supplied.
 */
function createDisabledBreaker() {
  return {
    isOpen: () => false,
    recordRateLimited: () => {},
    recordSuccess: () => {},
    state: () => ({ open: false, recent: 0, opensAt: null }),
  };
}

module.exports = { createRouterBreaker, createDisabledBreaker };
