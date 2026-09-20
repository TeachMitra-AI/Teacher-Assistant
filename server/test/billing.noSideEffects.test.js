// Billing (Phase 1) — switching billing ON must change nothing else.
//
// The promise of Phase 1: apart from GET /api/auth/me gaining a `billing` key
// and the new /api/admin/subscriptions routes, the app behaves exactly as it
// did. Each test below runs the same request with billing OFF and then ON and
// compares the two.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('Billing ON changes nothing else', () => {
  let fx;
  let teacherToken;
  let superToken;
  let saved;

  beforeAll(async () => {
    saved = process.env.BILLING_ENABLED;
    fx = await createFixtures(prisma, 'bnse');
    teacherToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    superToken = await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD);
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = saved;
  });

  const withBilling = (value) => {
    if (value === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = value;
  };

  const bearer = (token) => ({ Authorization: `Bearer ${token}` });

  // Runs `call` with billing off, then on, and returns both results.
  async function offAndOn(call) {
    withBilling(undefined);
    const off = await call();
    withBilling('true');
    const on = await call();
    return { off, on };
  }

  const keysOf = (obj) => Object.keys(obj).sort();

  test('login: same status, same top-level fields, same user fields, no billing anywhere', async () => {
    const { off, on } = await offAndOn(() =>
      request(app).post('/api/auth/login').send({ email: fx.teacherA.email, password: PASSWORD, schoolId: fx.schoolA.id })
    );
    expect(off.status).toBe(200);
    expect(on.status).toBe(200);
    expect(keysOf(on.body)).toEqual(keysOf(off.body));
    expect(keysOf(on.body.user)).toEqual(keysOf(off.body.user));
    expect(on.body).not.toHaveProperty('billing');
    expect(on.body.user).not.toHaveProperty('billing');
  });

  test('refresh: same status and fields, no billing anywhere', async () => {
    const { off, on } = await offAndOn(async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: PASSWORD, schoolId: fx.schoolA.id });
      return request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    });
    expect(off.status).toBe(200);
    expect(on.status).toBe(200);
    expect(keysOf(on.body)).toEqual(keysOf(off.body));
    expect(keysOf(on.body.user)).toEqual(keysOf(off.body.user));
    expect(JSON.stringify(on.body)).not.toContain('billing');
  });

  test('profile update (PATCH /me): unchanged shape, no billing', async () => {
    const { off, on } = await offAndOn(() =>
      request(app).patch('/api/auth/me').set(bearer(teacherToken)).send({ displayName: 'Same Name' })
    );
    expect(on.status).toBe(off.status);
    expect(keysOf(on.body)).toEqual(keysOf(off.body));
    expect(keysOf(on.body.user)).toEqual(keysOf(off.body.user));
    expect(on.body).not.toHaveProperty('billing');
  });

  test('history and library: identical responses', async () => {
    for (const path of ['/api/queries', '/api/resources']) {
      const { off, on } = await offAndOn(() => request(app).get(path).set(bearer(teacherToken)));
      expect(off.status).toBe(200);
      expect(on.status).toBe(off.status);
      expect(on.body).toEqual(off.body);
    }
  });

  test('the health check: same status and same fields (its timestamp differs by design)', async () => {
    const { off, on } = await offAndOn(() => request(app).get('/api/health'));
    expect(on.status).toBe(off.status);
    expect(on.body.status).toBe(off.body.status);
    expect(keysOf(on.body)).toEqual(keysOf(off.body));
  });

  test('existing admin routes are not shadowed by the new /api/admin/subscriptions mount', async () => {
    for (const path of ['/api/admin/users', '/api/admin/analytics', '/api/admin/schools']) {
      const { off, on } = await offAndOn(() => request(app).get(path).set(bearer(superToken)));
      expect(off.status).toBe(200);
      expect(on.status).toBe(off.status);
    }
  });

  test('a non-admin still cannot reach any admin route, with billing on', async () => {
    withBilling('true');
    for (const path of ['/api/admin/users', '/api/admin/subscriptions?userId=x']) {
      const res = await request(app).get(path).set(bearer(teacherToken));
      expect(res.status).toBe(403);
    }
  });

  test('a wrong token is still a 401 on /me, with billing on', async () => {
    withBilling('true');
    const res = await request(app).get('/api/auth/me').set(bearer('not-a-real-token'));
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('billing');
  });
});
