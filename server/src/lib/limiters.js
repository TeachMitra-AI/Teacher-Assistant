// Rate-limiter factory for POST /api/resources/generate. The other limiters (coach, assistant, auth) stay in index.js.
// It's a factory so a test can mount the real limiter on a throwaway Express app and exhaust that, instead of
// exhausting the shared app's bucket and poisoning later test files.
// /generate is the most expensive endpoint (a Gemini call with an 8-call budget behind it) and used to be guarded
// by authRequired alone. index.js mounts the limiter on the path ahead of the router.

const rateLimit = require('express-rate-limit');

const { parseIntEnv } = require('./config');

/**
 * Builds a 429 response body for any of this app's own rate limiters: the same `{error, code, retryAt}` shape
 * Gemini-key-exhaustion 429s already use (lib/sendAiError.js), so the client's existing RATE_LIMITED/retryAt
 * handling (api.ts's ApiError, the Coach/Generator countdown UI) treats them identically instead of needing a
 * separate code path per limiter. `req.rateLimit.resetTime` is set by express-rate-limit itself before this runs,
 * so unlike the Gemini case, every limiter built with this knows its own exact reset time for free.
 * @param {string} error the existing per-limiter wording, unchanged
 * @returns {(req: import('express').Request) => {error: string, code: 'RATE_LIMITED', retryAt?: string}}
 */
function rateLimitMessage(error) {
  return (req) => {
    const resetTime = req.rateLimit?.resetTime;
    return {
      error,
      code: 'RATE_LIMITED',
      ...(resetTime instanceof Date ? { retryAt: resetTime.toISOString() } : {}),
    };
  };
}

/**
 * Default ceiling per window, by environment. The generous non-production value is deliberate: the test suite
 * exercises /generate many times through the real app, and a production-shaped ceiling would fail it. If a
 * test needs an env change to pass, the default is wrong. In production, 30 per 15 minutes is about two
 * generations a minute sustained; it's env-tunable without a deploy.
 */
const GENERATE_LIMIT_DEFAULTS = Object.freeze({ production: 30, other: 600 });

/**
 * Build the limiter for POST /api/resources/generate. Keyed by IP like the other limiters, so a NAT'd school
 * shares one bucket, an accepted trade-off; per-user fairness is the daily budget's job (assistant/budget.js).
 * The message is worded for where it appears: client/src/api.ts turns a 429 into an ApiError carrying this
 * string, which the Generator shows in its error region.
 *
 * @param {object} options
 * @param {Record<string, string|undefined>} options.env
 * @param {boolean} options.isProduction
 * @param {number} options.windowMinutes shared with the app's other limiters
 * @returns {import('express').RequestHandler}
 */
function createGenerateLimiter({ env, isProduction, windowMinutes }) {
  const max = parseIntEnv(env.RESOURCE_GENERATE_RATE_LIMIT_MAX, {
    name: 'RESOURCE_GENERATE_RATE_LIMIT_MAX',
    defaultValue: isProduction ? GENERATE_LIMIT_DEFAULTS.production : GENERATE_LIMIT_DEFAULTS.other,
    min: 1,
    max: 100000,
  });

  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage(
      'You have generated a lot of content in a short time. Please wait a few minutes and try again.'
    ),
  });
}

module.exports = { createGenerateLimiter, GENERATE_LIMIT_DEFAULTS, rateLimitMessage };
