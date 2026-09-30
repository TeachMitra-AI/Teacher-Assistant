// Rate-limiter factory for POST /api/resources/generate. The other limiters (coach, assistant, auth) stay in index.js.
// It's a factory so a test can mount the real limiter on a throwaway Express app and exhaust that, instead of
// exhausting the shared app's bucket and poisoning later test files.
// /generate is the most expensive endpoint (a Gemini call with an 8-call budget behind it) and used to be guarded
// by authRequired alone. index.js mounts the limiter on the path ahead of the router.

const rateLimit = require('express-rate-limit');

const { parseIntEnv } = require('./config');

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
    message: {
      error: 'You have generated a lot of content in a short time. Please wait a few minutes and try again.',
    },
  });
}

module.exports = { createGenerateLimiter, GENERATE_LIMIT_DEFAULTS };
