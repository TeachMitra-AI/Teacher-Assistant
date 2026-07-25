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
