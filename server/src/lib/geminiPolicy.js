// Pure reliability-policy helpers for the Gemini integration. No I/O, no
// state, no clock/random of their own (callers inject rng where needed) — so
// every function here is deterministic and trivially unit-testable in
// isolation. gemini.js composes these; keeping them separate keeps the
// service lean and the retry/backoff logic independently verifiable.

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 * Supports both forms allowed by the spec: an integer number of seconds, or
 * an HTTP-date. Returns null when absent or unparseable, so the caller can
 * fall back to computed backoff.
 * @param {string|null|undefined} headerValue
 * @param {number} [nowMs] current time in ms (injectable for deterministic date math)
 * @returns {number|null} milliseconds to wait, or null
 */
function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue == null) return null;
  const raw = String(headerValue).trim();
  if (raw === '') return null;

  // delta-seconds form (e.g. "120")
  if (/^\d+$/.test(raw)) {
    return parseInt(raw, 10) * 1000;
  }

  // HTTP-date form (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return null;
}

/**
 * Bounded exponential backoff with full jitter.
 *
 * Base delay for a given zero-indexed attempt is `baseMs * 2^attempt`, capped
 * at `capMs`. Full jitter then picks a random value in [0, cappedBase] to
 * de-synchronize concurrent clients (avoids retry storms). If a server-
 * provided Retry-After (ms) is present it takes precedence over the computed
 * value (a rate-limited server knows better than our heuristic), but is still
 * subject to `capMs` unless `respectRetryAfterAboveCap` is true.
 *
 * @param {number} attempt zero-indexed retry attempt (0 = first retry)
 * @param {object} [opts]
 * @param {number} [opts.baseMs=500]
 * @param {number} [opts.capMs=8000]
 * @param {number|null} [opts.retryAfterMs=null] server Retry-After in ms, if any
 * @param {() => number} [opts.rng=Math.random] injectable RNG for deterministic tests
 * @returns {number} delay in milliseconds (integer, >= 0)
 */
function computeBackoffMs(attempt, opts = {}) {
  const { baseMs = 500, capMs = 8000, retryAfterMs = null, rng = Math.random } = opts;

  if (retryAfterMs != null && retryAfterMs >= 0) {
    // Honor the server's instruction, but never wait longer than the cap so a
    // pathological/hostile header can't stall a request (the overall deadline
    // in gemini.js is the ultimate backstop regardless).
    return Math.min(Math.round(retryAfterMs), capMs);
  }

  const safeAttempt = attempt < 0 ? 0 : attempt;
  const cappedBase = Math.min(capMs, baseMs * 2 ** safeAttempt);
  return Math.round(rng() * cappedBase);
}

// Statuses that represent a transient upstream condition worth retrying.
const RETRIABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Classify an error/response condition from a Gemini call into a retry
 * decision plus a stable machine-readable reason code. This is the single
 * source of truth for "what is retryable" — see the plan's decision matrix.
 *
 * @param {object} error an Error, optionally with `.status` (HTTP) and/or
 *   `.code` (app-level, e.g. INPUT_BLOCKED) and/or `.name` (e.g. TimeoutError)
 * @returns {{ retriable: boolean, reason: string }}
 */
function classifyGeminiError(error) {
  if (!error) return { retriable: false, reason: 'unknown' };

  // App-level safety blocks are raised AFTER a successful 200 response; they
  // are not transport failures and must never be retried.
  if (error.code === 'INPUT_BLOCKED' || error.code === 'OUTPUT_BLOCKED') {
    return { retriable: false, reason: 'safety_blocked' };
  }

  // Abort/timeout from AbortSignal.timeout has no HTTP status.
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return { retriable: true, reason: 'timeout' };
  }

  const status = error.status;
  if (status == null) {
    // No status → network-level failure (DNS, connection reset, etc.).
    return { retriable: true, reason: 'network' };
  }
  if (status === 429) {
    return { retriable: true, reason: 'rate_limited' };
  }
  if (RETRIABLE_STATUS.has(status)) {
    return { retriable: true, reason: 'upstream_5xx' };
  }
  if (status === 401 || status === 403) {
    return { retriable: false, reason: 'auth' };
  }
  if (status >= 400 && status < 500) {
    return { retriable: false, reason: 'client_error' };
  }
  // Any other status: be conservative and do not retry.
  return { retriable: false, reason: 'non_retriable' };
}

module.exports = { parseRetryAfter, computeBackoffMs, classifyGeminiError, RETRIABLE_STATUS };
