// Vitest setupFile, run in each test file's own context before its tests. globalSetup runs in a separate process, so
// its process.env changes don't propagate; the same test env is re-applied so `require('../../src/...')` modules that
// read env vars at require time (e.g. GEMINI_API_KEY/JWT_SECRET checks) see it.
const { applyTestEnv } = require('./testEnv');

applyTestEnv();
