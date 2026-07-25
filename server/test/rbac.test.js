const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('RBAC', () => {
  let fx;
  let tokens;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'rbac');
    tokens = {
      teacher: await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD),
      school_admin: await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD),
      resource_person: await loginAs(app, fx.schoolA, fx.resourcePersonA, PASSWORD),
      super_admin: await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD),
    };
  });

  function as(role) {
    return (req) => req.set('Authorization', `Bearer ${tokens[role]}`);
  }

  // Approve/reject only ever act on a `pending` account and are single-use, so
  // each case that expects to succeed needs a target of its own.
  let pendingSeq = 0;
  async function makePendingUser(schoolId = fx.schoolA.id) {
    pendingSeq += 1;
    return prisma.user.create({
      data: {
        schoolId,
        name: `Pending Teacher ${pendingSeq}`,
        email: `rbac-pending-${pendingSeq}@example.com`,
        role: 'teacher',
        status: 'pending',
        passwordHash: 'not-used-by-these-tests',
      },
    });
  }

  describe('GET /api/admin/analytics', () => {
    test.each(['school_admin', 'resource_person', 'super_admin'])('%s is allowed', async (role) => {
      const res = await as(role)(request(app).get('/api/admin/analytics'));
      expect(res.status).toBe(200);
    });
    test('teacher is denied', async () => {
      const res = await as('teacher')(request(app).get('/api/admin/analytics'));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/schools (super_admin only)', () => {
    test('super_admin is allowed', async () => {
      const res = await as('super_admin')(request(app).get('/api/admin/schools'));
      expect(res.status).toBe(200);
    });
    test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
      const res = await as(role)(request(app).get('/api/admin/schools'));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/users', () => {
    test.each(['school_admin', 'resource_person', 'super_admin'])('%s is allowed', async (role) => {
      const res = await as(role)(request(app).get('/api/admin/users'));
      expect(res.status).toBe(200);
    });
    test('teacher is denied', async () => {
      const res = await as('teacher')(request(app).get('/api/admin/users'));
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/users/:id/role (super_admin only)', () => {
    test('super_admin is allowed', async () => {
      const res = await as('super_admin')(
        request(app).patch(`/api/admin/users/${fx.teacherA2.id}/role`)
      ).send({ role: 'teacher' });
      expect(res.status).toBe(200);
    });
    test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
      const res = await as(role)(
        request(app).patch(`/api/admin/users/${fx.teacherA2.id}/role`)
      ).send({ role: 'teacher' });
      expect(res.status).toBe(403);
    });
  });

  // Approval-gated sign-up: every admin role can SEE the pending queue, but
  // only school_admin/super_admin may act on it.
  describe('GET /api/admin/users/pending', () => {
    test.each(['school_admin', 'resource_person', 'super_admin'])('%s is allowed', async (role) => {
      const res = await as(role)(request(app).get('/api/admin/users/pending'));
      expect(res.status).toBe(200);
    });
    test('teacher is denied', async () => {
      const res = await as('teacher')(request(app).get('/api/admin/users/pending'));
      expect(res.status).toBe(403);
    });
    test('only pending accounts are listed', async () => {
      await makePendingUser();
      const res = await as('school_admin')(request(app).get('/api/admin/users/pending'));
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      for (const u of res.body.users) expect(u.status).toBe('pending');
      // Never leaks credential material.
      for (const u of res.body.users) {
        expect(u.passwordHash).toBeUndefined();
        expect(u.googleSub).toBeUndefined();
      }
    });
  });

  describe('PATCH /api/admin/users/:id/approve (school_admin + super_admin only)', () => {
    test.each(['school_admin', 'super_admin'])('%s is allowed', async (role) => {
      const target = await makePendingUser();
      const res = await as(role)(request(app).patch(`/api/admin/users/${target.id}/approve`));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('active');
    });

    test.each(['teacher', 'resource_person'])('%s is denied', async (role) => {
      const target = await makePendingUser();
      const res = await as(role)(request(app).patch(`/api/admin/users/${target.id}/approve`));
      expect(res.status).toBe(403);
      // Denied means genuinely unchanged, not just an unhelpful response.
      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after.status).toBe('pending');
    });

    test('approving writes a user_approved Event naming the acting admin', async () => {
      const target = await makePendingUser();
      const res = await as('school_admin')(request(app).patch(`/api/admin/users/${target.id}/approve`));
      expect(res.status).toBe(200);

      const event = await prisma.event.findFirst({
        where: { type: 'user_approved', userId: fx.schoolAdminA.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(event).not.toBeNull();
      expect(JSON.parse(event.metadata).targetUserId).toBe(target.id);
    });

    test('approving twice is a 409 the second time', async () => {
      const target = await makePendingUser();
      const first = await as('school_admin')(request(app).patch(`/api/admin/users/${target.id}/approve`));
      expect(first.status).toBe(200);
      const second = await as('school_admin')(request(app).patch(`/api/admin/users/${target.id}/approve`));
      expect(second.status).toBe(409);
    });

    test('an unknown user id is a 404', async () => {
      const res = await as('school_admin')(request(app).patch('/api/admin/users/no-such-user-id/approve'));
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/admin/users/:id/reject (school_admin + super_admin only)', () => {
    test.each(['school_admin', 'super_admin'])('%s is allowed', async (role) => {
      const target = await makePendingUser();
      const res = await as(role)(request(app).patch(`/api/admin/users/${target.id}/reject`));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });

    test.each(['teacher', 'resource_person'])('%s is denied', async (role) => {
      const target = await makePendingUser();
      const res = await as(role)(request(app).patch(`/api/admin/users/${target.id}/reject`));
      expect(res.status).toBe(403);
      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after.status).toBe('pending');
    });

    test('an already-approved account cannot be rejected through this endpoint', async () => {
      const target = await makePendingUser();
      await as('school_admin')(request(app).patch(`/api/admin/users/${target.id}/approve`));
      const res = await as('school_admin')(request(app).patch(`/api/admin/users/${target.id}/reject`));
      expect(res.status).toBe(409);
      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after.status).toBe('active');
    });
  });

  test('GET /api/queries (own history) is allowed for every authenticated role', async () => {
    for (const role of ['teacher', 'school_admin', 'resource_person', 'super_admin']) {
      const res = await as(role)(request(app).get('/api/queries'));
      expect(res.status).toBe(200);
    }
  });

  test('every protected route rejects a missing token with 401', async () => {
    const routes = [
      '/api/admin/analytics',
      '/api/admin/schools',
      '/api/admin/users',
      '/api/admin/users/pending',
      '/api/queries',
    ];
    for (const route of routes) {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
    }
  });
});
