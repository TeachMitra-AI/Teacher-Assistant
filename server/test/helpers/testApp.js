// Loads the real Express app (server/src/index.js) for Supertest. Must only
// be required *after* the env setupFile has run (Vitest guarantees this via
// `setupFiles` in vitest.config.js) so the app's module-load-time env
// checks (GEMINI_API_KEY, JWT_SECRET) see valid test values.
const app = require('../../src/index');
const { prisma } = require('../../src/lib/db');

module.exports = { app, prisma };
