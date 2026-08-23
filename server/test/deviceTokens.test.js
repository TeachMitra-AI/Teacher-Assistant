// Phase 7b — device-token registration routes (POST/DELETE
// /api/notifications/device-tokens*) plus the logout-embedded cleanup added
// to POST /api/auth/logout. Mirrors notifications.test.js's shape: flag
// manipulation via process.env, fixtures from helpers/fixtures, loginAs for
// real HTTP-path tokens.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const PUSH_ENV_KEYS = ['MOBILE_PUSH_ENABLED'];

function enablePush() {
  process.env.MOBILE_PUSH_ENABLED = 'true';
}

describe('Device tokens (Phase 7b)', () => {
  let fx;
  let teacherAToken;
  let teacherA2Token;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'devtok');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherA2Token = await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD);
    savedEnv = Object.fromEntries(PUSH_ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function as(token) {
    return (req) => req.set('Authorization', `Bearer ${token}`);
  }

  describe('feature flag off', () => {
    beforeAll(() => { delete process.env.MOBILE_PUSH_ENABLED; });

    test('POST 503s and creates no row', async () => {
      const before = await prisma.deviceToken.count();
      const res = await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: 'ExponentPushToken[flagoff]', platform: 'android' })
      );
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MOBILE_PUSH_DISABLED');
      expect(await prisma.deviceToken.count()).toBe(before);
    });

    test('DELETE 503s', async () => {
      const res = await as(teacherAToken)(request(app).delete('/api/notifications/device-tokens/anything'));
      expect(res.status).toBe(503);
    });
  });

  describe('registration', () => {
    beforeAll(enablePush);

    test('requires a token', async () => {
      const res = await request(app)
        .post('/api/notifications/device-tokens')
        .send({ token: 'ExponentPushToken[noauth]', platform: 'android' });
      expect(res.status).toBe(401);
    });

    test('rejects an invalid platform', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: 'ExponentPushToken[abc12345]', platform: 'windows' })
      );
      expect(res.status).toBe(400);
    });

    test('rejects a too-short token', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: 'x', platform: 'android' })
      );
      expect(res.status).toBe(400);
    });

    test('registers a new token owned by the caller', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: 'ExponentPushToken[teacherA-device]', platform: 'android' })
      );
      expect(res.status).toBe(201);
      const row = await prisma.deviceToken.findUnique({ where: { token: 'ExponentPushToken[teacherA-device]' } });
      expect(row.userId).toBe(fx.teacherA.id);
      expect(row.platform).toBe('android');
    });

    test('re-registering the SAME token under a different caller reassigns ownership (upsert, not duplicate)', async () => {
      const shared = 'ExponentPushToken[shared-device]';
      const first = await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: shared, platform: 'ios' })
      );
      expect(first.status).toBe(201);

      const second = await as(teacherA2Token)(
        request(app).post('/api/notifications/device-tokens').send({ token: shared, platform: 'ios' })
      );
      expect(second.status).toBe(201);

      const rows = await prisma.deviceToken.findMany({ where: { token: shared } });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(fx.teacherA2.id);
    });
  });

  describe('unregistration (DELETE)', () => {
    beforeAll(enablePush);

    test('requires a token', async () => {
      const res = await request(app).delete('/api/notifications/device-tokens/whatever');
      expect(res.status).toBe(401);
    });

    test("a different user's device token 404s and is not deleted", async () => {
      const token = 'ExponentPushToken[ownership-check]';
      await as(teacherAToken)(request(app).post('/api/notifications/device-tokens').send({ token, platform: 'android' }));

      const foreignAttempt = await as(teacherA2Token)(
        request(app).delete(`/api/notifications/device-tokens/${encodeURIComponent(token)}`)
      );
      expect(foreignAttempt.status).toBe(404);
      expect(await prisma.deviceToken.findUnique({ where: { token } })).toBeTruthy();
    });

    test('the owning user can unregister their own token', async () => {
      const token = 'ExponentPushToken[owned-delete]';
      await as(teacherAToken)(request(app).post('/api/notifications/device-tokens').send({ token, platform: 'android' }));

      const ownAttempt = await as(teacherAToken)(
        request(app).delete(`/api/notifications/device-tokens/${encodeURIComponent(token)}`)
      );
      expect(ownAttempt.status).toBe(200);
      expect(await prisma.deviceToken.findUnique({ where: { token } })).toBeNull();
    });

    test('an unknown token 404s', async () => {
      const res = await as(teacherAToken)(
        request(app).delete(`/api/notifications/device-tokens/${encodeURIComponent('ExponentPushToken[never-existed]')}`)
      );
      expect(res.status).toBe(404);
    });
  });

  describe('logout-embedded cleanup', () => {
    beforeAll(enablePush);

    test('POST /auth/logout with a deviceToken removes it server-side, scoped to the session owner', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: fx.PASSWORD, schoolId: fx.schoolA.id });
      expect(loginRes.status).toBe(200);
      const { token: accessToken, refreshToken } = loginRes.body;

      const deviceToken = 'ExponentPushToken[logout-cleanup]';
      const regRes = await request(app)
        .post('/api/notifications/device-tokens')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: deviceToken, platform: 'android' });
      expect(regRes.status).toBe(201);

      const logoutRes = await request(app).post('/api/auth/logout').send({ refreshToken, deviceToken });
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      expect(await prisma.deviceToken.findUnique({ where: { token: deviceToken } })).toBeNull();
    });

    test('logout with a deviceToken but no valid refreshToken leaves the device token alone (no attributable owner)', async () => {
      const deviceToken = 'ExponentPushToken[orphan-safe]';
      await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: deviceToken, platform: 'android' })
      );

      const res = await request(app).post('/api/auth/logout').send({ refreshToken: 'not-a-real-refresh-token', deviceToken });
      expect(res.status).toBe(200);

      expect(await prisma.deviceToken.findUnique({ where: { token: deviceToken } })).toBeTruthy();
    });

    test("logout never removes a DIFFERENT user's device token even if that token string is guessed", async () => {
      const deviceToken = 'ExponentPushToken[not-yours-to-remove]';
      await as(teacherAToken)(
        request(app).post('/api/notifications/device-tokens').send({ token: deviceToken, platform: 'android' })
      );

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: fx.teacherA2.email, password: fx.PASSWORD, schoolId: fx.schoolA.id });
      const { refreshToken: teacherA2RefreshToken } = loginRes.body;

      const res = await request(app).post('/api/auth/logout').send({ refreshToken: teacherA2RefreshToken, deviceToken });
      expect(res.status).toBe(200);

      expect(await prisma.deviceToken.findUnique({ where: { token: deviceToken } })).toBeTruthy();
    });
  });
});
