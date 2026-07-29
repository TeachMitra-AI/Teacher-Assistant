// Rate-limiter factories (Milestone M9).
//
// SCOPE, STATED SO IT IS NOT WIDENED BY ACCIDENT: this module exists for the ONE
// limiter M9 adds — the guard on POST /api/resources/generate. The three
// limiters index.js already constructs (coach, assistant, auth) are deliberately
// NOT moved here (approval A9). Refactoring working limiters into a new module
// would be a change to protected behaviour bought for tidiness, and this
// milestone is hardening, not housekeeping.
//
// ─── WHY A FACTORY AND NOT AN INLINE rateLimit() CALL IN index.js ──────────
// So a test can mount THE REAL LIMITER. The server suite runs with
// fileParallelism: false and shares one required src/index.js per worker, which
// means exhausting the app's own bucket to prove it returns 429 would poison
// every test file that runs afterwards. With a factory, the limiter test builds
// a throwaway Express app around the same function index.js calls, exhausts
// that, and leaves the shared app untouched. The alternative — asserting on a
// hand-rolled copy of the configuration — would be a test of the copy.
//
// ─── WHY /generate NEEDED A LIMITER AT ALL ─────────────────────────────────
// It is the most expensive endpoint in the product: a real Gemini call with an
// 8-call budget behind it, and until now it was guarded by authRequired and
// nothing else. Architecture 10.4 flags this as a pre-existing gap to be closed
// "regardless of this project" — the router only makes reaching it one utterance
// cheaper. Note this file does not touch routes/resources.js (protected area 1);
// index.js mounts the limiter on the path ahead of the router.

const rateLimit = require('express-rate-limit');

const { parseIntEnv } = require('./config');

/**
 * Default ceiling per window, by environment.
 *
 * ─── THE NON-PRODUCTION VALUE IS LOAD-BEARING, NOT ARBITRARY ───────────────
 * The server test suite exercises POST /api/resources/generate many times
 * through the real app, and resources.test.js is a PROTECTED file that must pass
 * 70/70 unmodified (protected area 1 and 12). A production-shaped ceiling would
 * fail it, and the tempting fix would be to edit either that test or the shared
 * test env helper — both forbidden by G26. So the generous non-production
 * default is what keeps the guard honest: if a test ever needs an env change to
 * pass, the DEFAULT is wrong, not the test.
 *
 * The production value is a real limit: 30 per 15 minutes is roughly two
 * generations a minute sustained, well above a teacher preparing lessons and
 * well below a loop. It is env-tunable without a deploy.
 */
const GENERATE_LIMIT_DEFAULTS = Object.freeze({ production: 30, other: 600 });

/**
 * Build the limiter for POST /api/resources/generate.
 *
 * Keyed by IP, like every other limiter in this app (approval A5). A NAT'd
 * school therefore shares one bucket — an accepted Phase 1 trade-off, recorded
 * rather than discovered later: per-user fairness is the daily budget's job
 * (assistant/budget.js), and introducing a fourth keying model for one endpoint
 * would make the app's rate-limiting story harder to reason about than the
 * problem it solves.
 *
 * The message is worded for the surface it will actually appear on. A 429 here
 * reaches client/src/api.ts, which turns it into an ApiError carrying this
 * string, which the Generator renders in its existing error region — so no
 * client change is needed and the teacher reads a sentence rather than a status
 * code.
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
