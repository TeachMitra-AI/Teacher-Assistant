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
  RATE_LIMIT_WINDOW_MINUTES: '15',
  RATE_LIMIT_MAX_REQUESTS: '1000', // generous — rate limiting itself isn't under test here
  // Kept small so route-level retry tests (ai-safety.test.js) stay fast.
  // Only affects the shared GeminiService instance index.js constructs from
  // env — gemini.contract.test.js builds its own GeminiService with explicit
  // config and is unaffected by these.
  LLM_TIMEOUT_MS: '5000',
  LLM_MAX_RETRIES: '1',
};

function applyTestEnv() {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
}

module.exports = { TEST_DB_PATH, TEST_ENV, applyTestEnv };
