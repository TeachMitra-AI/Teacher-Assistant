// Vitest setupFile: runs inside each test file's own context before its
// tests execute. globalSetup (test/globalSetup.js) runs in a separate
// process, so its process.env changes don't propagate here — we re-apply
// the same test env values so that `require('../../src/...')` modules
// (which read env vars at require-time, e.g. GEMINI_API_KEY/JWT_SECRET
// existence checks) see them.
const { applyTestEnv } = require('./testEnv');

applyTestEnv();
