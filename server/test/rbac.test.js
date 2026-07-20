const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PIN } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('RBAC', () => {
  let fx;
  let tokens;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'rbac');
    tokens = {
      teacher: await loginAs(app, fx.schoolA, fx.teacherA, PIN),
      school_admin: await loginAs(app, fx.schoolA, fx.schoolAdminA, PIN),
      resource_person: await loginAs(app, fx.schoolA, fx.resourcePersonA, PIN),
      super_admin: await loginAs(app, fx.schoolA, fx.superAdmin, PIN),
    };
  });

  function as(role) {
    return (req) => req.set('Authorization', `Bearer ${tokens[role]}`);
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

  test('GET /api/queries (own history) is allowed for every authenticated role', async () => {
    for (const role of ['teacher', 'school_admin', 'resource_person', 'super_admin']) {
      const res = await as(role)(request(app).get('/api/queries'));
      expect(res.status).toBe(200);
    }
  });

  test('every protected route rejects a missing token with 401', async () => {
    const routes = ['/api/admin/analytics', '/api/admin/schools', '/api/admin/users', '/api/queries'];
    for (const route of routes) {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
    }
  });
});
