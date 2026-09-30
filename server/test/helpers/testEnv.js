// Single source of truth for the test environment, used by the Vitest globalSetup (to migrate the throwaway DB) and the
// per-file setup (so process.env is populated before `src/*` modules that read env vars at require time load).
// It's SQLite, in a throwaway file separate from server/prisma/dev.db, never the developer's real database.
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
  // Password reset. The Brevo key is a dummy (password-reset.test.js stubs global fetch), but it must be set: lib/email.js treats an absent key as "email not configured" and skips the send.
  BREVO_API_KEY: 'test-dummy-brevo-key-not-real',
  EMAIL_FROM: 'Teacher Assistant <test@example.com>',
  APP_URL: 'http://localhost:5173',
  PASSWORD_RESET_TTL_MINUTES: '60',
  // Google sign-in. A dummy value: google-auth.test.js mocks verifyIdToken. It must be set, since an absent client ID disables the feature (POST /auth/google -> 503), and it's asserted as the expected audience.
  GOOGLE_CLIENT_ID: 'test-dummy-google-client-id.apps.googleusercontent.com',
  RATE_LIMIT_WINDOW_MINUTES: '15',
  RATE_LIMIT_MAX_REQUESTS: '1000', // generous — rate limiting itself isn't under test here
  // The shared test app's rate-limiter state persists across every test in a file (one in-memory store keyed by IP), so a
  // file with enough generate() calls could exhaust .env's production-sized default (30) before it finishes.
  RESOURCE_GENERATE_RATE_LIMIT_MAX: '1000',
  // Same reasoning: classroom.attendance.test.js exercises bulk-mark and
  // export endpoints many times through the shared app.
  CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS: '5000',
  // The router's own budgets, separate from the LLM_* values below. The production defaults (3.5s per call, 5s overall)
  // are wrong here: exceeding the deadline is a passthrough, not an error, so under a full suite on a busy machine a
  // mocked call occasionally crossed 3.5s and happy-path tests asserting `passthrough === false` failed at random (about 2
  // runs in 9, never reproducible in isolation). Raised so the assistant tests measure routing, not machine load. Timeout
  // behaviour is still covered: those tests set their own deadlines.
  ASSISTANT_LLM_TIMEOUT_MS: '10000',
  ASSISTANT_LLM_TOTAL_TIMEOUT_MS: '15000',
  // Kept small so route-level retry tests stay fast. It only affects the shared GeminiService index.js builds from env;
  // gemini.contract.js and gemini.reliability.js build their own with explicit config.
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
