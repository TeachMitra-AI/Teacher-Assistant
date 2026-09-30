// Loads the real Express app (server/src/index.js) for Supertest. Require it only after the env setupFile has run
// (Vitest guarantees this via `setupFiles`), so the app's module-load env checks (GEMINI_API_KEY, JWT_SECRET) see valid test values.
const app = require('../../src/index');
const { prisma } = require('../../src/lib/db');

module.exports = { app, prisma };
