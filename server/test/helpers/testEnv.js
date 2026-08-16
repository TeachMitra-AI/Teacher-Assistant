// Single source of truth for the test environment. Used by both the Vitest
// globalSetup (to migrate the throwaway DB before any test runs) and the
// per-file setup (to make sure process.env is populated before `src/*`
// modules — which read env vars at require-time — are loaded).
//
// Deliberately still SQLite: this project stays on the existing SQLite
// datasource for the whole Phase 0 pass. This is a separate throwaway file
// from server/prisma/dev.db, never the developer's real local database.
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', '.tmp-test.db');

const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: `file:${TEST_DB_PATH}`,
  GEMINI_API_KEY: 'test-dummy-gemini-key-not-real',
  JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters-long',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '7',
  TOKEN_TTL: '15m',
  CORS_ORIGINS: 'http://localhost:5173',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCKOUT_MINUTES: '15',
  // Password reset. The Brevo key is a dummy — password-reset.test.js stubs
  // global fetch so no request ever leaves the process — but it has to be
  // *set*, because lib/email.js treats an absent key as "email not configured"
  // and skips the send entirely.
  BREVO_API_KEY: 'test-dummy-brevo-key-not-real',
  EMAIL_FROM: 'Teacher Assistant <test@example.com>',
  APP_URL: 'http://localhost:5173',
  PASSWORD_RESET_TTL_MINUTES: '60',
  // Google sign-in. Dummy value: google-auth.test.js mocks verifyIdToken, so
  // nothing is ever verified against Google. It must be set, though, because
  // an absent client ID disables the feature (POST /auth/google -> 503), and
  // it's asserted on as the expected audience.
  GOOGLE_CLIENT_ID: 'test-dummy-google-client-id.apps.googleusercontent.com',
  RATE_LIMIT_WINDOW_MINUTES: '15',
  RATE_LIMIT_MAX_REQUESTS: '1000', // generous — rate limiting itself isn't under test here
  // Same reasoning: the shared test app's rate-limiter state persists across
  // every test in a file (one in-memory store, keyed by IP), so a file with
  // enough generate() calls can otherwise exhaust .env's production-sized
  // default (30) well before the file finishes.
  RESOURCE_GENERATE_RATE_LIMIT_MAX: '1000',
  // Same reasoning: classroom.attendance.test.js exercises bulk-mark and
  // export endpoints many times through the shared app.
  CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS: '5000',
  // The AI Action Router's OWN budgets, which are separate from the LLM_*
  // values below and were previously left at their production defaults
  // (3.5s per call, 5s overall — see index.js ASSISTANT_LLM_TIMEOUT_MS).
  //
  // Those defaults are right in production and wrong here. The router treats
  // exceeding its deadline as PASSTHROUGH — "a DECISION, NOT AN ERROR"
  // (guardrail G20) — so a call that merely runs slow does not fail loudly, it
  // quietly returns `passthrough: true`. Under a full ~50-second suite on a
  // busy machine, a mocked call occasionally crossed 3.5s and the happy-path
  // tests that assert `passthrough === false` failed at random: roughly 2 runs
  // in 9, a different test each time, never reproducible in isolation.
  //
  // Raised here so the assistant tests measure ROUTING, not the machine's load
  // at that moment. Same reasoning, and same shape, as the two rate-limit
  // ceilings below — this pair was simply missed when they were added.
  // Timeout BEHAVIOUR is still covered: the tests that exercise it set their
  // own deadlines explicitly rather than relying on these defaults.
  ASSISTANT_LLM_TIMEOUT_MS: '10000',
  ASSISTANT_LLM_TOTAL_TIMEOUT_MS: '15000',
  // Kept small so route-level retry tests stay fast. Only affects the shared
  // GeminiService instance index.js constructs from env — gemini.contract.js
  // and gemini.reliability.js build their own GeminiService with explicit
  // config and are unaffected by these.
  LLM_TIMEOUT_MS: '5000',
  LLM_MAX_RETRIES: '1',
  LLM_TOTAL_TIMEOUT_MS: '15000',
  LLM_MAX_CALLS_PER_REQUEST: '8',
  LLM_MAX_CONTINUATIONS: '4',
  LLM_MAX_OUTPUT_TOKENS: '8192',
};

function applyTestEnv() {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
}

module.exports = { TEST_DB_PATH, TEST_ENV, applyTestEnv };
