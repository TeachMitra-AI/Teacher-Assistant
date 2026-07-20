const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./test/globalSetup.js'],
    setupFiles: ['./test/helpers/env.js'],
    // Tests share one throwaway SQLite file (see test/helpers/env.js) —
    // run test files sequentially so they don't race on it.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
