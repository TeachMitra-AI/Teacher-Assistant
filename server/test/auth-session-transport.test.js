// Web sessions keep the refresh token in an HttpOnly cookie, so page scripts can't read it. Mobile and other clients with no
// cookie jar still get it in the body. These tests cover the cookie contract, the CSRF gate on cookie-authenticated routes,
// logout, and which routes the per-IP limiter counts.
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { setRefreshCookie, clearRefreshCookie } = require('../src/middleware/auth');

const http = makeClient(app);
const COOKIE_NAME = 'sarastech_refresh';
const TRANSPORT = { 'X-Session-Transport': 'cookie' };

// The Set-Cookie line for the refresh cookie, or undefined.
function refreshSetCookie(res) {
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
}

// The Cookie request header value for a Set-Cookie line, e.g. "sarastech_refresh=abc".
function cookieHeaderFrom(setCookieLine) {
  return setCookieLine.split(';')[0];
}

describe('web session transport (refresh token in an HttpOnly cookie)', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'xport');
  });

  async function loginWeb(user = fx.teacherA) {
    return http.post('/api/auth/login').set(TRANSPORT).send({ email: user.email, password: PASSWORD, schoolId: fx.schoolA.id });
  }

  test('a web login keeps the refresh token out of the body and sets it as a HttpOnly, path-scoped, SameSite=Lax cookie', async () => {
    const res = await loginWeb();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();

    const cookie = refreshSetCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Not Secure under NODE_ENV=test; production turns it on (see the attribute unit tests below).
    expect(cookie).not.toMatch(/Secure/i);
    expect(cookieHeaderFrom(cookie).length).toBeGreaterThan(COOKIE_NAME.length + 20);
  });

  test('a client with no cookie jar (mobile, older builds) still gets the refresh token in the body, and the cookie too', async () => {
    const res = await http.post('/api/auth/login').send({ email: fx.teacherA2.email, password: PASSWORD, schoolId: fx.schoolA.id });
    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(refreshSetCookie(res)).toBeTruthy();
  });

  test('refresh works from the cookie alone when the transport header is present, and rotates the cookie', async () => {
    const login = await loginWeb(fx.teacherA2);
    const first = refreshSetCookie(login);

    const refreshed = await http.post('/api/auth/refresh').set(TRANSPORT).set('Cookie', cookieHeaderFrom(first));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.token).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeUndefined();

    const rotated = refreshSetCookie(refreshed);
    expect(rotated).toBeTruthy();
    expect(cookieHeaderFrom(rotated)).not.toBe(cookieHeaderFrom(first));
  });

  test('the cookie alone is NOT honoured without the transport header (CSRF guard for cookie-authenticated routes)', async () => {
    const login = await loginWeb(fx.teacherA);
    const cookie = cookieHeaderFrom(refreshSetCookie(login));

    const res = await http.post('/api/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });

  test('logout clears the cookie and revokes the session, so the old cookie can no longer refresh', async () => {
    const login = await loginWeb(fx.schoolAdminA);
    const cookie = cookieHeaderFrom(refreshSetCookie(login));

    const out = await http.post('/api/auth/logout').set(TRANSPORT).set('Cookie', cookie).send({});
    expect(out.status).toBe(200);
    const cleared = refreshSetCookie(out);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const after = await http.post('/api/auth/refresh').set(TRANSPORT).set('Cookie', cookie).send({});
    expect(after.status).toBe(401);
  });

  test('a logout with no cookie and no body still succeeds, so the client can always clear its state', async () => {
    const res = await http.post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe('refresh cookie attributes', () => {
  const originalEnv = { NODE_ENV: process.env.NODE_ENV, REFRESH_COOKIE_SAMESITE: process.env.REFRESH_COOKIE_SAMESITE };

  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.REFRESH_COOKIE_SAMESITE === undefined) delete process.env.REFRESH_COOKIE_SAMESITE;
    else process.env.REFRESH_COOKIE_SAMESITE = originalEnv.REFRESH_COOKIE_SAMESITE;
  });

  function captureCookie(fn) {
    const calls = [];
    const res = { cookie: (...args) => calls.push(['set', ...args]), clearCookie: (...args) => calls.push(['clear', ...args]) };
    fn(res);
    return calls[0];
  }

  test('production sets Secure, HttpOnly, SameSite=Lax, scoped to /api/auth', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REFRESH_COOKIE_SAMESITE;
    const [, name, , options] = captureCookie((res) => setRefreshCookie(res, 'token-value'));
    expect(name).toBe('sarastech_refresh');
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth' });
    expect(options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('SameSite=None is only ever paired with Secure, even outside production', () => {
    process.env.NODE_ENV = 'test';
    process.env.REFRESH_COOKIE_SAMESITE = 'none';
    const [, , , options] = captureCookie((res) => setRefreshCookie(res, 'token-value'));
    expect(options.sameSite).toBe('none');
    expect(options.secure).toBe(true);
  });

  test('clearing uses the same path and flags, so the browser actually removes the cookie', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REFRESH_COOKIE_SAMESITE;
    const [, name, options] = captureCookie((res) => clearRefreshCookie(res));
    expect(name).toBe('sarastech_refresh');
    expect(options).toMatchObject({ path: '/api/auth', httpOnly: true, secure: true, sameSite: 'lax' });
  });
});

describe('per-IP rate limiting covers credential endpoints only', () => {
  // /me, /refresh and /logout are called on every page load and by every open tab, so counting them let a school behind one
  // public IP lock its own teachers out. Each sends well over the limiter's test-env cap of 300 per IP, and none may be
  // answered with 429.
  test('GET /me is not rate-limited by the auth limiter', async () => {
    const client = makeClient(app, '203.0.113.50');
    for (let i = 0; i < 320; i++) {
      const res = await client.get('/api/auth/me');
      expect(res.status).toBe(401);
    }
  }, 60000);

  test('POST /refresh is not rate-limited by the auth limiter', async () => {
    const client = makeClient(app, '203.0.113.51');
    for (let i = 0; i < 320; i++) {
      const res = await client.post('/api/auth/refresh').send({ refreshToken: 'a'.repeat(30) });
      expect(res.status).toBe(401);
    }
  }, 60000);
});
