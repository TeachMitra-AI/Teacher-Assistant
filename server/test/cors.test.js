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

  // Regression coverage for the P2-002 exploratory-QA finding
  // (docs/enterprise-exploratory-qa-report.md): a malformed JSON body used to
  // reach the error handler's clean 400 response WITHOUT
  // Access-Control-Allow-Origin, because cors() was registered after the
  // JSON body-parser and so never ran when the parser threw. That made a
  // correct 400 unreadable to the browser, which reported a generic
  // "Failed to fetch" instead. cors() is now registered before the
  // body-parser (see src/index.js), so its headers are attached regardless
  // of what a later middleware throws.
  describe('malformed JSON body + CORS (P2-002 regression)', () => {
    test('dev mode: malformed JSON from any origin gets 400 + the real error body + CORS header', async () => {
      process.env.NODE_ENV = 'test';
      for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
      const devApp = reloadApp();

      const res = await request(devApp)
        .post('/api/auth/login')
        .set('Origin', 'https://anything.example.org')
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'The request body was not valid JSON.' });
      expect(res.headers['access-control-allow-origin']).toBe('https://anything.example.org');
    });

    test('production: malformed JSON from an allowed origin gets 400 + the real error body + CORS header', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://allowed.example.org';
      for (const [k, v] of Object.entries(TEST_ENV)) {
        if (k !== 'NODE_ENV' && k !== 'CORS_ORIGINS') process.env[k] = v;
      }
      const prodApp = reloadApp();

      const res = await request(prodApp)
        .post('/api/auth/login')
        .set('Origin', 'https://allowed.example.org')
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'The request body was not valid JSON.' });
      expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example.org');

      // Restore test env for any subsequent tests/files.
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = TEST_ENV.CORS_ORIGINS;
      reloadApp();
    });

    test('production: malformed JSON from a disallowed origin is still blocked, not given CORS headers', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://allowed.example.org';
      for (const [k, v] of Object.entries(TEST_ENV)) {
        if (k !== 'NODE_ENV' && k !== 'CORS_ORIGINS') process.env[k] = v;
      }
      const prodApp = reloadApp();

      const res = await request(prodApp)
        .post('/api/auth/login')
        .set('Origin', 'https://evil.example.org')
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      // Blocked-origin behavior is unchanged by the reorder: the request
      // never reaches the malformed-JSON branch's 400, and it must not carry
      // an Access-Control-Allow-Origin for the disallowed origin.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      // Restore test env for any subsequent tests/files.
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = TEST_ENV.CORS_ORIGINS;
      reloadApp();
    });

    test('valid JSON body from an allowed origin is unaffected by the reorder', async () => {
      process.env.NODE_ENV = 'test';
      for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
      const devApp = reloadApp();

      const res = await request(devApp)
        .post('/api/auth/login')
        .set('Origin', 'https://anything.example.org')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

      // Valid JSON always reaches the route handler now, same as before this
      // fix — this asserts the reorder didn't change ordinary request
      // handling, only what happens when the parser itself throws.
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Incorrect email or password.' });
      expect(res.headers['access-control-allow-origin']).toBe('https://anything.example.org');
    });
  });
});
