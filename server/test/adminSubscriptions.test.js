// Billing (Phase 1) — /api/admin/subscriptions: a super_admin gives, looks up
// and removes a teacher's Pro plan by hand.
//
// What must hold:
//   - only super_admin can use it (401 with no token, 403 for every other role),
//     and with BILLING_ENABLED off every route answers 503 and writes nothing
//   - one running Pro row per user: granting again while it runs ADDS months;
//     granting after it ended, or while it is only in grace, starts fresh
//   - every change writes exactly one audit Event; a repeated revoke writes none
//   - request bodies are strict: unknown fields, bad months and other plans are
//     rejected with 400
//   - nothing here touches any other user
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { addMonths } = require('../src/lib/entitlements');

const DAY = 24 * 60 * 60 * 1000;

describe('Billing — /api/admin/subscriptions', () => {
  let fx;
  let superAdminToken;
  let schoolAdminToken;
  let resourcePersonToken;
  let teacherToken;
  let savedBilling;
  let counter = 0;

  beforeAll(async () => {
    savedBilling = process.env.BILLING_ENABLED;
    process.env.BILLING_ENABLED = 'true';

    fx = await createFixtures(prisma, 'bsub');
    superAdminToken = await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD);
    schoolAdminToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD);
    resourcePersonToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, PASSWORD);
    teacherToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  afterAll(() => {
    if (savedBilling === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = savedBilling;
  });

  beforeEach(() => {
    process.env.BILLING_ENABLED = 'true';
  });

  // A fresh teacher per test, so no test can affect another through shared rows.
  async function newTarget(role = 'teacher') {
    counter += 1;
    return prisma.user.create({
      data: {
        schoolId: fx.schoolA.id,
        name: `Billing Target ${counter}`,
        email: `bsub-target-${counter}@example.com`,
        role,
        passwordHash: 'not-used',
        status: 'active',
      },
    });
  }

  const asSuper = (req) => req.set('Authorization', `Bearer ${superAdminToken}`);
  const grant = (body) => asSuper(request(app).post('/api/admin/subscriptions')).send(body);
  const lookup = (userId) => asSuper(request(app).get('/api/admin/subscriptions')).query({ userId });
  const revoke = (id) => asSuper(request(app).post(`/api/admin/subscriptions/${id}/revoke`));
  const rowsFor = (userId) => prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  async function eventsFor(userId) {
    const events = await prisma.event.findMany({
      where: { userId: fx.superAdmin.id, type: { startsWith: 'subscription_' } },
      orderBy: { createdAt: 'asc' },
    });
    return events
      .map((e) => ({ ...e, meta: JSON.parse(e.metadata) }))
      .filter((e) => e.meta.targetUserId === userId);
  }

  describe('access control', () => {
    test('no token: 401 on every route', async () => {
      const target = await newTarget();
      expect((await request(app).post('/api/admin/subscriptions').send({ userId: target.id, planKey: 'teacher_pro', months: 1 })).status).toBe(401);
      expect((await request(app).get('/api/admin/subscriptions').query({ userId: target.id })).status).toBe(401);
      expect((await request(app).post('/api/admin/subscriptions/anything/revoke')).status).toBe(401);
      expect(await rowsFor(target.id)).toHaveLength(0);
    });

    test.each([
      ['a teacher', () => teacherToken],
      ['a school_admin', () => schoolAdminToken],
      ['a resource_person', () => resourcePersonToken],
    ])('%s gets 403 on every route and nothing is written', async (_label, getToken) => {
      const target = await newTarget();
      const auth = (req) => req.set('Authorization', `Bearer ${getToken()}`);
      const post = await auth(request(app).post('/api/admin/subscriptions')).send({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      const get = await auth(request(app).get('/api/admin/subscriptions')).query({ userId: target.id });
      const rev = await auth(request(app).post('/api/admin/subscriptions/anything/revoke'));
      expect([post.status, get.status, rev.status]).toEqual([403, 403, 403]);
      expect(await rowsFor(target.id)).toHaveLength(0);
    });

    test('billing OFF: 503 with code BILLING_DISABLED on every route, and nothing is written', async () => {
      const target = await newTarget();
      process.env.BILLING_ENABLED = 'false';
      const post = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      const get = await lookup(target.id);
      const rev = await revoke('anything');
      expect([post.status, get.status, rev.status]).toEqual([503, 503, 503]);
      expect(post.body.code).toBe('BILLING_DISABLED');
      expect(await rowsFor(target.id)).toHaveLength(0);
      expect(await eventsFor(target.id)).toHaveLength(0);
    });

    test('billing OFF still answers 401 and 403 first (the gate order)', async () => {
      process.env.BILLING_ENABLED = 'false';
      expect((await request(app).get('/api/admin/subscriptions').query({ userId: 'x' })).status).toBe(401);
      const res = await request(app).get('/api/admin/subscriptions').query({ userId: 'x' }).set('Authorization', `Bearer ${teacherToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST / — grant', () => {
    test('creates a manual Pro row that ends the right number of months later', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1, note: '  pilot tester  ' });

      expect(res.status).toBe(201);
      expect(res.body.extended).toBe(false);
      const sub = res.body.subscription;
      expect(sub).toMatchObject({
        userId: target.id,
        planKey: 'teacher_pro',
        status: 'active',
        source: 'manual',
        grantedById: fx.superAdmin.id,
        note: 'pilot tester',
      });
      expect(new Date(sub.endsAt).getTime()).toBe(addMonths(new Date(sub.startsAt), 1).getTime());
      expect(res.body.entitlements).toMatchObject({ plan: 'teacher_pro', state: 'active', endsAt: sub.endsAt });
      expect(await rowsFor(target.id)).toHaveLength(1);
    });

    test('an empty note is stored as no note', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1, note: '   ' });
      expect(res.status).toBe(201);
      expect(res.body.subscription.note).toBeNull();
    });

    test('months up to 36 are accepted', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 36 });
      expect(res.status).toBe(201);
      expect(new Date(res.body.subscription.endsAt).getTime()).toBe(addMonths(new Date(res.body.subscription.startsAt), 36).getTime());
    });

    test('granting again while Pro is running ADDS months and keeps one row', async () => {
      const target = await newTarget();
      const first = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      const second = await grant({ userId: target.id, planKey: 'teacher_pro', months: 2, note: 'renewed' });

      expect(second.status).toBe(200);
      expect(second.body.extended).toBe(true);
      expect(second.body.subscription.id).toBe(first.body.subscription.id);
      expect(new Date(second.body.subscription.endsAt).getTime()).toBe(
        addMonths(new Date(first.body.subscription.endsAt), 2).getTime()
      );
      expect(second.body.subscription.note).toBe('renewed');
      expect(await rowsFor(target.id)).toHaveLength(1);
    });

    test('granting after Pro ENDED (past grace) starts a fresh row from now', async () => {
      const target = await newTarget();
      const old = await prisma.subscription.create({
        data: {
          userId: target.id, planKey: 'teacher_pro', status: 'active', source: 'manual',
          startsAt: new Date(Date.now() - 60 * DAY), endsAt: new Date(Date.now() - 30 * DAY),
        },
      });
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });

      expect(res.status).toBe(201);
      expect(res.body.extended).toBe(false);
      expect(res.body.subscription.id).not.toBe(old.id);
      expect(new Date(res.body.subscription.startsAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(res.body.entitlements.state).toBe('active');
      expect(await rowsFor(target.id)).toHaveLength(2);
    });

    test('granting while Pro is only in GRACE starts a fresh month from now (it is not extended)', async () => {
      const target = await newTarget();
      const inGrace = await prisma.subscription.create({
        data: {
          userId: target.id, planKey: 'teacher_pro', status: 'active', source: 'manual',
          startsAt: new Date(Date.now() - 31 * DAY), endsAt: new Date(Date.now() - 1 * DAY),
        },
      });
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });

      expect(res.status).toBe(201);
      expect(res.body.subscription.id).not.toBe(inGrace.id);
      expect(res.body.entitlements.state).toBe('active');
    });

    test('a revoked row is never extended: granting creates a new one', async () => {
      const target = await newTarget();
      const first = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      await revoke(first.body.subscription.id);
      const again = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });

      expect(again.status).toBe(201);
      expect(again.body.subscription.id).not.toBe(first.body.subscription.id);
      expect(again.body.entitlements.state).toBe('active');
    });

    test('two grants at the same moment still leave exactly one running row', async () => {
      const target = await newTarget();
      const [a, b] = await Promise.all([
        grant({ userId: target.id, planKey: 'teacher_pro', months: 1 }),
        grant({ userId: target.id, planKey: 'teacher_pro', months: 1 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      const running = (await rowsFor(target.id)).filter((r) => r.status === 'active' && r.endsAt > new Date());
      expect(running).toHaveLength(1);
    });

    test('touches only the target user', async () => {
      const target = await newTarget();
      const bystander = await newTarget();
      await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });

      expect(await rowsFor(bystander.id)).toHaveLength(0);
      expect((await lookup(bystander.id)).body.entitlements.state).toBe('basic');
    });

    test('a user in another school can be granted too (super_admin sees all schools)', async () => {
      const res = await grant({ userId: fx.teacherB.id, planKey: 'teacher_pro', months: 1 });
      expect(res.status).toBe(201);
      expect(res.body.subscription.userId).toBe(fx.teacherB.id);
    });

    test('an unknown user: 404, and no row and no audit event', async () => {
      const before = await prisma.event.count({ where: { type: { startsWith: 'subscription_' } } });
      const res = await grant({ userId: 'no-such-user', planKey: 'teacher_pro', months: 1 });
      expect(res.status).toBe(404);
      expect(await prisma.subscription.count({ where: { userId: 'no-such-user' } })).toBe(0);
      expect(await prisma.event.count({ where: { type: { startsWith: 'subscription_' } } })).toBe(before);
    });
  });

  describe('POST / — the body is strict', () => {
    let target;
    beforeAll(async () => { target = await newTarget(); });

    test.each([
      ['an unknown field', { userId: 'U', planKey: 'teacher_pro', months: 1, price: 1 }],
      ['a smuggled status', { userId: 'U', planKey: 'teacher_pro', months: 1, status: 'revoked' }],
      ['months = 0', { userId: 'U', planKey: 'teacher_pro', months: 0 }],
      ['months = 37', { userId: 'U', planKey: 'teacher_pro', months: 37 }],
      ['months = -1', { userId: 'U', planKey: 'teacher_pro', months: -1 }],
      ['a fractional months', { userId: 'U', planKey: 'teacher_pro', months: 1.5 }],
      ['months as a string', { userId: 'U', planKey: 'teacher_pro', months: '1' }],
      ['months missing', { userId: 'U', planKey: 'teacher_pro' }],
      ['Basic (it is never stored)', { userId: 'U', planKey: 'teacher_basic', months: 1 }],
      ['an unknown plan', { userId: 'U', planKey: 'platinum', months: 1 }],
      ['planKey missing', { userId: 'U', months: 1 }],
      ['userId missing', { planKey: 'teacher_pro', months: 1 }],
      ['an empty userId', { userId: '', planKey: 'teacher_pro', months: 1 }],
      ['an over-long note', { userId: 'U', planKey: 'teacher_pro', months: 1, note: 'x'.repeat(501) }],
    ])('rejects %s with 400 and writes nothing', async (_label, body) => {
      const payload = { ...body };
      if (payload.userId === 'U') payload.userId = target.id;
      const res = await grant(payload);
      expect(res.status).toBe(400);
      expect(await rowsFor(target.id)).toHaveLength(0);
    });

    test('an empty body: 400', async () => {
      expect((await grant({})).status).toBe(400);
    });
  });

  describe('audit trail', () => {
    test('a grant writes one subscription_granted event, by the admin', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 3 });
      const events = await eventsFor(target.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('subscription_granted');
      expect(events[0].userId).toBe(fx.superAdmin.id);
      expect(events[0].schoolId).toBe(target.schoolId);
      expect(events[0].meta).toMatchObject({
        targetUserId: target.id,
        targetEmail: target.email,
        subscriptionId: res.body.subscription.id,
        planKey: 'teacher_pro',
        months: 3,
      });
    });

    test('an extension writes a subscription_extended event', async () => {
      const target = await newTarget();
      await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      expect((await eventsFor(target.id)).map((e) => e.type)).toEqual(['subscription_granted', 'subscription_extended']);
    });

    test('a revoke writes one subscription_revoked event, and repeating it writes none', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      await revoke(res.body.subscription.id);
      await revoke(res.body.subscription.id);
      expect((await eventsFor(target.id)).map((e) => e.type)).toEqual(['subscription_granted', 'subscription_revoked']);
    });
  });

  describe('GET / — look up', () => {
    test('a user with no rows: an empty list and Basic', async () => {
      const target = await newTarget();
      const res = await lookup(target.id);
      expect(res.status).toBe(200);
      expect(res.body.subscriptions).toEqual([]);
      expect(res.body.entitlements).toMatchObject({ plan: 'teacher_basic', state: 'basic', endsAt: null });
    });

    test('shows the rows, newest first, with what the resolver makes of them', async () => {
      const target = await newTarget();
      await prisma.subscription.create({
        data: {
          userId: target.id, planKey: 'teacher_pro', status: 'active', source: 'manual',
          startsAt: new Date(Date.now() - 90 * DAY), endsAt: new Date(Date.now() - 60 * DAY),
        },
      });
      const current = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });

      const res = await lookup(target.id);
      expect(res.body.subscriptions).toHaveLength(2);
      expect(res.body.subscriptions[0].id).toBe(current.body.subscription.id);
      expect(res.body.entitlements.state).toBe('active');
    });

    test('rows are shown as plain fields, with no relation leaked', async () => {
      const target = await newTarget();
      await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      const row = (await lookup(target.id)).body.subscriptions[0];
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'endsAt', 'grantedById', 'id', 'note', 'planKey', 'source', 'startsAt', 'status', 'updatedAt', 'userId']
      );
    });

    test('a super_admin is reported as exempt', async () => {
      const res = await lookup(fx.superAdmin.id);
      expect(res.body.entitlements.state).toBe('exempt');
    });

    test('no userId, an empty userId, an array, or an extra key: 400', async () => {
      const call = (query) => asSuper(request(app).get('/api/admin/subscriptions')).query(query);
      expect((await call({})).status).toBe(400);
      expect((await call({ userId: '' })).status).toBe(400);
      expect((await call({ userId: ['a', 'b'] })).status).toBe(400);
      expect((await call({ userId: fx.teacherA.id, extra: '1' })).status).toBe(400);
    });

    test('an unknown user: 404', async () => {
      expect((await lookup('no-such-user')).status).toBe(404);
    });
  });

  describe('POST /:id/revoke', () => {
    test('ends the row: the user is back on Basic, and only that row changed', async () => {
      const target = await newTarget();
      const other = await newTarget();
      const mine = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      const theirs = await grant({ userId: other.id, planKey: 'teacher_pro', months: 1 });

      const res = await revoke(mine.body.subscription.id);
      expect(res.status).toBe(200);
      expect(res.body.subscription.status).toBe('revoked');
      expect(Object.keys(res.body.subscription)).not.toContain('user');

      expect((await lookup(target.id)).body.entitlements.state).toBe('basic');
      expect((await lookup(other.id)).body.entitlements.state).toBe('active');
      expect((await prisma.subscription.findUnique({ where: { id: theirs.body.subscription.id } })).status).toBe('active');
    });

    test('repeating it is a harmless success', async () => {
      const target = await newTarget();
      const res = await grant({ userId: target.id, planKey: 'teacher_pro', months: 1 });
      expect((await revoke(res.body.subscription.id)).status).toBe(200);
      const again = await revoke(res.body.subscription.id);
      expect(again.status).toBe(200);
      expect(again.body.subscription.status).toBe('revoked');
    });

    test('an unknown id, and an over-long id: 404', async () => {
      expect((await revoke('no-such-row')).status).toBe(404);
      expect((await revoke('x'.repeat(200))).status).toBe(404);
    });
  });
});
