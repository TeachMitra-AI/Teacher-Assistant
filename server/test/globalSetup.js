// Vitest globalSetup, run once before any test file: creates a fresh throwaway SQLite database (separate from
// prisma/dev.db) and applies the current Prisma migrations, so tests run against an up-to-date empty schema.
const fs = require('fs');
const { execSync } = require('child_process');
const { TEST_DB_PATH, TEST_ENV, applyTestEnv } = require('./helpers/testEnv');

module.exports = async function globalSetup() {
  applyTestEnv();

  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, ...TEST_ENV },
    stdio: 'inherit',
  });

  return async function teardown() {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const file = TEST_DB_PATH + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  };
};
