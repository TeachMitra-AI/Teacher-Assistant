// Billing (Phase 1) — the billing block on GET /api/auth/me.
//
// The rules:
//   - billing OFF (the default): the response is EXACTLY what it was before
//     billing existed — no `billing` key at all, and the same user fields —
//     even for a user who has a Pro row in the database
//   - billing ON: a `billing` key appears BESIDE `user` and `featureFlags`,
//     and everything else in the response is identical to the OFF response
//   - the block is right for Basic, Pro, grace, ended, revoked and exempt users
//   - a billing failure can never break /me
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const DAY = 24 * 60 * 60 * 1000;

// The fields publicUser() has always returned. If this list changes, a shared
// response (login, refresh, /me, profile update) changed.
const USER_KEYS = ['avatarUrl', 'createdAt', 'displayName', 'email', 'id', 'name', 'preferences', 'role', 'school'];

describe('Billing — GET /api/auth/me', () => {
  let fx;
  let teacherToken;
  let teacher2Token;
  let superToken;
  let saved;

  const ENV_KEYS = ['BILLING_ENABLED', 'BILLING_BASIC_MAX_CLASSES', 'BILLING_GRACE_DAYS', 'BILLING_EXEMPT_ROLES'];

  beforeAll(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    fx = await createFixtures(prisma, 'bme');
    teacherToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    teacher2Token = await loginAs(app, fx.schoolA, fx.teacherA2, PASSWORD);
    superToken = await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(async () => {
    await prisma.subscription.deleteMany({ where: { userId: { in: [fx.teacherA.id, fx.teacherA2.id, fx.superAdmin.id] } } });
  });

  const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const giveRow = (userId, { endsAt, status = 'active', planKey = 'teacher_pro' }) =>
    prisma.subscription.create({
      data: { userId, planKey, status, source: 'manual', startsAt: new Date(Date.now() - 40 * DAY), endsAt },
    });

  describe('billing OFF', () => {
    test('unset: exactly user and featureFlags, with today\'s user fields', async () => {
      const res = await me(teacherToken);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['featureFlags', 'user']);
      expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    });

    test.each(['false', '0', 'off', 'ture'])('BILLING_ENABLED=%j: still no billing key', async (value) => {
      process.env.BILLING_ENABLED = value;
      const res = await me(teacherToken);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('billing');
      expect(Object.keys(res.body).sort()).toEqual(['featureFlags', 'user']);
    });

    test('a user WITH a Pro row still sees nothing about billing while it is off', async () => {
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() + 10 * DAY) });
      const res = await me(teacherToken);
      expect(res.body).not.toHaveProperty('billing');
      expect(JSON.stringify(res.body)).not.toContain('teacher_pro');
    });

    test('the billing lookup is not even attempted', async () => {
      // Swapped by plain assignment (and put back the same way), not vi.spyOn +
      // mockRestore: restoring a spy on a Prisma delegate method can leave it
      // undefined for every later test in the file.
      const original = prisma.subscription.findMany;
      const replacement = vi.fn(async () => []);
      prisma.subscription.findMany = replacement;
      try {
        await me(teacherToken);
        expect(replacement).not.toHaveBeenCalled();
      } finally {
        prisma.subscription.findMany = original;
      }
    });
  });

  describe('billing ON', () => {
    beforeEach(() => { process.env.BILLING_ENABLED = 'true'; });

    test('everything except the new key is identical to the OFF response', async () => {
      delete process.env.BILLING_ENABLED;
      const off = await me(teacherToken);
      process.env.BILLING_ENABLED = 'true';
      const on = await me(teacherToken);

      expect(on.status).toBe(200);
      expect(Object.keys(on.body).sort()).toEqual(['billing', 'featureFlags', 'user']);
      const { billing, ...rest } = on.body;
      expect(billing).toBeDefined();
      expect(rest).toEqual(off.body);
    });

    test('the block sits beside user, never inside it', async () => {
      const res = await me(teacherToken);
      expect(res.body.user).not.toHaveProperty('billing');
      expect(Object.keys(res.body.user).sort()).toEqual(USER_KEYS);
    });

    test('a teacher with no row: Basic with the free limits', async () => {
      const res = await me(teacherToken);
      expect(res.body.billing).toEqual({
        plan: 'teacher_basic',
        state: 'basic',
        endsAt: null,
        graceEndsAt: null,
        features: { reportDownloads: false, classroomMode: false, lessonPlans: false },
        limits: { classes: 2, questionsPerMonth: 50, imagesPerMonth: 10, pdfsPerMonth: 5 },
      });
    });

    test('a running Pro row: active and unlimited', async () => {
      const endsAt = new Date(Date.now() + 10 * DAY);
      await giveRow(fx.teacherA.id, { endsAt });
      const res = await me(teacherToken);

      expect(res.body.billing).toMatchObject({
        plan: 'teacher_pro',
        state: 'active',
        endsAt: endsAt.toISOString(),
        features: { reportDownloads: true, classroomMode: true, lessonPlans: true },
        limits: { classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null },
      });
      expect(res.body.billing.graceEndsAt).toBe(new Date(endsAt.getTime() + 3 * DAY).toISOString());
    });

    test('a row that ended a day ago: still Pro, in grace', async () => {
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() - 1 * DAY) });
      const res = await me(teacherToken);
      expect(res.body.billing).toMatchObject({ plan: 'teacher_pro', state: 'grace' });
    });

    test('a row that ended long ago: back to Basic', async () => {
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() - 20 * DAY) });
      const res = await me(teacherToken);
      expect(res.body.billing).toMatchObject({ plan: 'teacher_basic', state: 'basic', endsAt: null });
    });

    test('a revoked row is ignored', async () => {
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() + 10 * DAY), status: 'revoked' });
      const res = await me(teacherToken);
      expect(res.body.billing.state).toBe('basic');
    });

    test('one teacher\'s plan is never shown to another', async () => {
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() + 10 * DAY) });
      expect((await me(teacherToken)).body.billing.state).toBe('active');
      expect((await me(teacher2Token)).body.billing.state).toBe('basic');
    });

    test('a super_admin is exempt', async () => {
      const res = await me(superToken);
      expect(res.body.billing).toMatchObject({
        plan: 'teacher_pro',
        state: 'exempt',
        endsAt: null,
        limits: { classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null },
      });
    });

    test('the limits come from the environment', async () => {
      process.env.BILLING_BASIC_MAX_CLASSES = '7';
      const res = await me(teacherToken);
      expect(res.body.billing.limits.classes).toBe(7);
    });

    test('the grace days come from the environment', async () => {
      process.env.BILLING_GRACE_DAYS = '0';
      await giveRow(fx.teacherA.id, { endsAt: new Date(Date.now() - 1 * DAY) });
      const res = await me(teacherToken);
      expect(res.body.billing.state).toBe('basic');
    });

    test('a database error in the billing lookup: /me still succeeds, without the key', async () => {
      const original = prisma.subscription.findMany;
      prisma.subscription.findMany = vi.fn(async () => { throw new Error('db is gone'); });
      const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await me(teacherToken);
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('billing');
        expect(res.body.user.id).toBe(fx.teacherA.id);
        expect(logSpy.mock.calls.some((c) => String(c[0]).includes('[billing]'))).toBe(true);
      } finally {
        prisma.subscription.findMany = original;
        logSpy.mockRestore();
      }
    });

    test('and the very next request works normally again (nothing was left broken)', async () => {
      const res = await me(teacherToken);
      expect(res.status).toBe(200);
      expect(res.body.billing.state).toBe('basic');
    });

    test('still requires a token', async () => {
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
    });
  });
});
