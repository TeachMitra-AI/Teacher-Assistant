const request = require('supertest');
const bcrypt = require('bcryptjs');
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
    // Role targets are created per-test: several cases below leave the target
    // at a different role than they found it.
    let roleSeq = 0;
    // Hashed with the real PASSWORD rather than a placeholder: the
    // last-super-admin case has to log in as one of these users.
    async function makeUser(role = 'teacher', schoolId = fx.schoolA.id) {
      roleSeq += 1;
      return prisma.user.create({
        data: {
          schoolId,
          name: `Role Target ${roleSeq}`,
          email: `rbac-role-${roleSeq}@example.com`,
          role,
          status: 'active',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      });
    }

    test('super_admin is allowed', async () => {
      const target = await makeUser('teacher');
      const res = await as('super_admin')(
        request(app).patch(`/api/admin/users/${target.id}/role`)
      ).send({ role: 'school_admin' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('school_admin');
      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after.role).toBe('school_admin');
    });

    test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
      const res = await as(role)(
        request(app).patch(`/api/admin/users/${fx.teacherA2.id}/role`)
      ).send({ role: 'teacher' });
      expect(res.status).toBe(403);
    });

    // The client raises a confirmation dialog in front of this endpoint, but
    // these guards are what hold for a direct API call.
    test('a super_admin cannot change their own role', async () => {
      const res = await as('super_admin')(
        request(app).patch(`/api/admin/users/${fx.superAdmin.id}/role`)
      ).send({ role: 'teacher' });
      expect(res.status).toBe(403);
      const after = await prisma.user.findUnique({ where: { id: fx.superAdmin.id } });
      expect(after.role).toBe('super_admin');
    });

    test('the last super_admin cannot be demoted', async () => {
      // The guard counts super admins globally, so this case only means
      // anything when the fixture super admin really is the only one left —
      // other test files seed their own. Test files run sequentially
      // (fileParallelism: false), so borrowing them for one request is safe.
      const others = await prisma.user.findMany({
        where: { role: 'super_admin', id: { not: fx.superAdmin.id } },
        select: { id: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: others.map((u) => u.id) } },
        data: { role: 'teacher' },
      });
      try {
        // Acting as the fixture super admin on itself would hit the
        // self-change guard first, so the request comes from a second super
        // admin created only for this check.
        const actor = await makeUser('super_admin');
        const token = await loginAs(app, fx.schoolA, actor, PASSWORD);

        const res = await request(app)
          .patch(`/api/admin/users/${fx.superAdmin.id}/role`)
          .set('Authorization', `Bearer ${token}`)
          .send({ role: 'teacher' });
        // Two super admins exist (fixture + actor), so this one succeeds.
        expect(res.status).toBe(200);

        // Now only `actor` is left. Demoting it must be refused.
        const lastRes = await as('super_admin')(
          request(app).patch(`/api/admin/users/${actor.id}/role`)
        ).send({ role: 'teacher' });
        expect(lastRes.status).toBe(409);
        const after = await prisma.user.findUnique({ where: { id: actor.id } });
        expect(after.role).toBe('super_admin');

        await prisma.user.update({ where: { id: actor.id }, data: { role: 'teacher' } });
      } finally {
        await prisma.user.update({ where: { id: fx.superAdmin.id }, data: { role: 'super_admin' } });
        await prisma.user.updateMany({
          where: { id: { in: others.map((u) => u.id) } },
          data: { role: 'super_admin' },
        });
      }
    });

    test('changing a role writes a user_role_changed Event naming the acting admin', async () => {
      const target = await makeUser('teacher');
      const res = await as('super_admin')(
        request(app).patch(`/api/admin/users/${target.id}/role`)
      ).send({ role: 'super_admin' });
      expect(res.status).toBe(200);

      const event = await prisma.event.findFirst({
        where: { type: 'user_role_changed', userId: fx.superAdmin.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(event).not.toBeNull();
      const metadata = JSON.parse(event.metadata);
      expect(metadata.targetUserId).toBe(target.id);
      expect(metadata.fromRole).toBe('teacher');
      expect(metadata.toRole).toBe('super_admin');
    });

    test('re-sending the role a user already has writes no Event', async () => {
      const target = await makeUser('school_admin');
      const before = await prisma.event.count({ where: { type: 'user_role_changed' } });
      const res = await as('super_admin')(
        request(app).patch(`/api/admin/users/${target.id}/role`)
      ).send({ role: 'school_admin' });
      expect(res.status).toBe(200);
      expect(await prisma.event.count({ where: { type: 'user_role_changed' } })).toBe(before);
    });

    test('an unknown user id is a 404', async () => {
      const res = await as('super_admin')(
        request(app).patch('/api/admin/users/no-such-user-id/role')
      ).send({ role: 'teacher' });
      expect(res.status).toBe(404);
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
