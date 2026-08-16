// Notification System — GET/PATCH/POST /api/notifications*. Mirrors
// adminSupport.test.js's shape: flag manipulation via process.env (routes
// read it per-request, same convention as attachments.test.js), fixtures
// from helpers/fixtures, and loginAs for real HTTP-path tokens.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const NOTIF_ENV_KEYS = ['NOTIFICATIONS_ENABLED'];

function enableNotifications() {
  process.env.NOTIFICATIONS_ENABLED = 'true';
}

describe('Notification System', () => {
  let fx;
  let superAdminToken;
  let schoolAdminAToken;
  let resourcePersonAToken;
  let teacherAToken;
  let teacherA2Token;
  let teacherBToken;
  let schoolAdminBToken;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'notif');
    superAdminToken = await loginAs(app, fx.schoolA, fx.superAdmin, fx.PASSWORD);
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, fx.PASSWORD);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, fx.PASSWORD);
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherA2Token = await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, fx.PASSWORD);
    schoolAdminBToken = await loginAs(app, fx.schoolB, fx.schoolAdminB, fx.PASSWORD);
    savedEnv = Object.fromEntries(NOTIF_ENV_KEYS.map((k) => [k, process.env[k]]));
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
    beforeAll(() => { delete process.env.NOTIFICATIONS_ENABLED; });

    test('every route 503s and creates no row', async () => {
      const before = await prisma.notification.count();
      const res = await as(superAdminToken)(
        request(app).post('/api/notifications').send({
          title: 'x', message: 'y', type: 'announcement', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('NOTIFICATIONS_DISABLED');
      const after = await prisma.notification.count();
      expect(after).toBe(before);

      const listRes = await as(teacherAToken)(request(app).get('/api/notifications'));
      expect(listRes.status).toBe(503);
    });
  });

  describe('access control (flag on)', () => {
    beforeAll(enableNotifications);

    test('requires a token', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    test('teacher is rejected from sending with 403', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/notifications').send({
          title: 'x', message: 'y', type: 'announcement', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(403);
    });

    test.each([
      ['school_admin', () => schoolAdminAToken],
      ['resource_person', () => resourcePersonAToken],
      ['super_admin', () => superAdminToken],
    ])('%s can send', async (_label, getToken) => {
      const res = await as(getToken())(
        request(app).post('/api/notifications').send({
          title: 'Access check', message: 'hello', type: 'announcement', target: { scope: 'users', userIds: [fx.teacherA.id] },
        })
      );
      expect(res.status).toBe(201);
    });
  });

  describe('scope enforcement', () => {
    beforeAll(enableNotifications);

    test('super_admin scope:all reaches every fixture user, including a different school', async () => {
      const res = await as(superAdminToken)(
        request(app).post('/api/notifications').send({
          title: 'Platform-wide', message: 'hello everyone', type: 'announcement', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(201);
      const teacherBUnread = await prisma.notification.findFirst({
        where: { recipientId: fx.teacherB.id, title: 'Platform-wide' },
      });
      expect(teacherBUnread).toBeTruthy();
    });

    test("school_admin's scope:all is downgraded to their own school, never reaching another school", async () => {
      const res = await as(schoolAdminAToken)(
        request(app).post('/api/notifications').send({
          title: 'School A only', message: 'hello school A', type: 'announcement', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBeGreaterThan(0);

      const reachedTeacherA = await prisma.notification.findFirst({
        where: { recipientId: fx.teacherA.id, title: 'School A only' },
      });
      expect(reachedTeacherA).toBeTruthy();

      const reachedTeacherB = await prisma.notification.findFirst({
        where: { recipientId: fx.teacherB.id, title: 'School A only' },
      });
      expect(reachedTeacherB).toBeNull();
    });

    test("a foreign schoolId in scope:'school' reaches zero recipients, not an error", async () => {
      const res = await as(schoolAdminAToken)(
        request(app).post('/api/notifications').send({
          title: 'Foreign school attempt',
          message: 'should reach nobody',
          type: 'announcement',
          target: { scope: 'school', schoolIds: [fx.schoolB.id] },
        })
      );
      expect(res.status).toBe(201);
      expect(res.body.recipientCount).toBe(0);
    });

    test("scope:'role' is ANDed with the sender's own school scope", async () => {
      const res = await as(schoolAdminAToken)(
        request(app).post('/api/notifications').send({
          title: 'Teachers only, school A',
          message: 'hi teachers',
          type: 'announcement',
          target: { scope: 'role', roles: ['teacher'] },
        })
      );
      expect(res.status).toBe(201);

      const reachedTeacherA = await prisma.notification.findFirst({
        where: { recipientId: fx.teacherA.id, title: 'Teachers only, school A' },
      });
      expect(reachedTeacherA).toBeTruthy();

      const reachedSchoolAdminA = await prisma.notification.findFirst({
        where: { recipientId: fx.schoolAdminA.id, title: 'Teachers only, school A' },
      });
      expect(reachedSchoolAdminA).toBeNull();

      const reachedTeacherB = await prisma.notification.findFirst({
        where: { recipientId: fx.teacherB.id, title: 'Teachers only, school A' },
      });
      expect(reachedTeacherB).toBeNull();
    });
  });

  describe('list / unread-count / read / read-all', () => {
    let recipientId;
    let recipientToken;
    let bystanderToken;

    beforeAll(async () => {
      enableNotifications();
      // A fully SEPARATE fixture set (own schools/users), not the shared `fx`
      // — the scope-enforcement block above sends role/school-wide broadcasts
      // that legitimately reach every teacher in `fx`, including teacherA2.
      // Reusing that fixture here would make the count/list assertions below
      // depend on execution order instead of on what this block writes.
      const listFx = await createFixtures(prisma, 'notiflist');
      recipientId = listFx.teacherA.id;
      recipientToken = await loginAs(app, listFx.schoolA, listFx.teacherA, listFx.PASSWORD);
      bystanderToken = await loginAs(app, listFx.schoolA, listFx.teacherA2, listFx.PASSWORD);
      await prisma.notification.createMany({
        data: [
          { recipientId, type: 'announcement', title: 'First', message: 'm1', createdAt: new Date(Date.now() - 2000) },
          { recipientId, type: 'announcement', title: 'Second', message: 'm2', createdAt: new Date(Date.now() - 1000) },
          { recipientId, type: 'announcement', title: 'Third', message: 'm3', createdAt: new Date() },
        ],
      });
    });

    test('GET /notifications lists newest first, scoped to the caller only', async () => {
      const res = await as(recipientToken)(request(app).get('/api/notifications?limit=100'));
      expect(res.status).toBe(200);
      const titles = res.body.notifications.map((n) => n.title);
      expect(titles.indexOf('Third')).toBeLessThan(titles.indexOf('Second'));
      expect(titles.indexOf('Second')).toBeLessThan(titles.indexOf('First'));

      // A different user's list never contains these rows.
      const otherRes = await as(bystanderToken)(request(app).get('/api/notifications?limit=100'));
      expect(otherRes.body.notifications.some((n) => n.title === 'First')).toBe(false);
    });

    test('unread-count matches actual unread rows', async () => {
      const res = await as(recipientToken)(request(app).get('/api/notifications/unread-count'));
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(3);
    });

    test("PATCH /:id/read only affects the caller's own row — a different user's id 404s", async () => {
      const list = await as(recipientToken)(request(app).get('/api/notifications?limit=100'));
      const target = list.body.notifications.find((n) => n.title === 'First');

      const foreignAttempt = await as(bystanderToken)(request(app).patch(`/api/notifications/${target.id}/read`));
      expect(foreignAttempt.status).toBe(404);

      const ownAttempt = await as(recipientToken)(request(app).patch(`/api/notifications/${target.id}/read`));
      expect(ownAttempt.status).toBe(200);
      expect(ownAttempt.body.read).toBe(true);

      const countAfter = await as(recipientToken)(request(app).get('/api/notifications/unread-count'));
      expect(countAfter.body.count).toBe(2);
    });

    test('PATCH /read-all zeroes the count in one call', async () => {
      const res = await as(recipientToken)(request(app).patch('/api/notifications/read-all'));
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);

      const countAfter = await as(recipientToken)(request(app).get('/api/notifications/unread-count'));
      expect(countAfter.body.count).toBe(0);
    });
  });

  describe('input validation', () => {
    beforeAll(enableNotifications);

    test('rejects an empty title', async () => {
      const res = await as(superAdminToken)(
        request(app).post('/api/notifications').send({
          title: '', message: 'hello', type: 'announcement', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(400);
    });

    test('rejects a system-only type (not admin-sendable)', async () => {
      const res = await as(superAdminToken)(
        request(app).post('/api/notifications').send({
          title: 'x', message: 'y', type: 'lesson_generated', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(400);
    });

    test('rejects an absolute URL as link', async () => {
      const res = await as(superAdminToken)(
        request(app).post('/api/notifications').send({
          title: 'x', message: 'y', type: 'announcement', link: 'https://evil.example.com', target: { scope: 'all' },
        })
      );
      expect(res.status).toBe(400);
    });
  });

  test('cross-school isolation: a school B admin sending scope:all never reaches school A', async () => {
    enableNotifications();
    const res = await as(schoolAdminBToken)(
      request(app).post('/api/notifications').send({
        title: 'School B broadcast', message: 'hi', type: 'announcement', target: { scope: 'all' },
      })
    );
    expect(res.status).toBe(201);

    const reachedTeacherA = await prisma.notification.findFirst({
      where: { recipientId: fx.teacherA.id, title: 'School B broadcast' },
    });
    expect(reachedTeacherA).toBeNull();

    const reachedTeacherB = await prisma.notification.findFirst({
      where: { recipientId: fx.teacherB.id, title: 'School B broadcast' },
    });
    expect(reachedTeacherB).toBeTruthy();
  });
});
