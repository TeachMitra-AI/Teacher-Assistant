// Verifies the Section-3 CORS fix: production fails fast on a missing
// allowlist instead of silently reflecting any origin, and once configured,
// only listed origins are actually allowed.
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { TEST_ENV } = require('./helpers/testEnv');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.js');

// vi.resetModules() targets Vite's/Vitest's own module graph (mainly ESM
// import()); it does not clear Node's native require.cache, which is what
// plain CJS `require()` calls in this codebase actually use. Busting the
// cache entry directly forces src/index.js to be freshly re-evaluated (with
// whatever process.env is set at that moment) on the next require().
function reloadApp() {
  delete require.cache[require.resolve('../src/index')];
  return require('../src/index');
}

describe('CORS', () => {
  test('production boot refuses to start when CORS_ORIGINS is empty', () => {
    const result = spawnSync(process.execPath, [INDEX_PATH], {
      env: { ...process.env, ...TEST_ENV, NODE_ENV: 'production', CORS_ORIGINS: '' },
      encoding: 'utf-8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FATAL.*CORS_ORIGINS/);
  });

  test('production boot succeeds when CORS_ORIGINS is populated, and only allows listed origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://allowed.example.org';
    for (const [k, v] of Object.entries(TEST_ENV)) {
      if (k !== 'NODE_ENV' && k !== 'CORS_ORIGINS') process.env[k] = v;
    }

    // require.main !== module here (we're requiring it from a test file), so
    // this does NOT bind a real port — see the guard added in src/index.js.
    const prodApp = reloadApp();

    const allowed = await request(prodApp).get('/api/health').set('Origin', 'https://allowed.example.org');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example.org');

    const denied = await request(prodApp).get('/api/health').set('Origin', 'https://evil.example.org');
    expect(denied.status).toBeGreaterThanOrEqual(400);

    // Restore test env for any subsequent tests/files.
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = TEST_ENV.CORS_ORIGINS;
    reloadApp();
  });

  test('development mode (no NODE_ENV=production) reflects any origin', async () => {
    process.env.NODE_ENV = 'test'; // anything other than 'production'
    for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
    const devApp = reloadApp();

    const res = await request(devApp).get('/api/health').set('Origin', 'https://anything.example.org');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://anything.example.org');
  });
});
