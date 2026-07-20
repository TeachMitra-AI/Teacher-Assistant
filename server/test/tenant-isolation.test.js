// Highest-value regression protection identified in the audit: a bug in
// schoolScope() or an ownership check would leak one school's/teacher's
// data to another. These tests assert that never happens.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PIN } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('tenant isolation', () => {
  let fx;
  let schoolAdminAToken;
  let resourcePersonAToken;
  let teacherAToken;
  let teacherBToken;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'tenant');
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PIN);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, PIN);
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, PIN);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, PIN);
  });

  test('school_admin only ever sees users from their own school', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${schoolAdminAToken}`);
    expect(res.status).toBe(200);
    const names = res.body.users.map((u) => u.name);
    expect(names).toContain(fx.teacherA.name);
    expect(names).not.toContain(fx.teacherB.name);
    expect(names).not.toContain(fx.schoolAdminB.name);
  });

  test('school_admin analytics never surface another school\'s question content', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${schoolAdminAToken}`);
    expect(res.status).toBe(200);
    // Fixture: School A only ever asked about "Mathematics"; School B only
    // ever asked about "Science". If isolation broke, School B's subject
    // would leak into School A's admin's aggregation.
    const subjects = res.body.bySubject.map((s) => s.label);
    expect(subjects).toContain('Mathematics');
    expect(subjects).not.toContain('Science');
  });

  test('resource_person sees their own district but not another district\'s school', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${resourcePersonAToken}`);
    expect(res.status).toBe(200);
    const names = res.body.users.map((u) => u.name);
    expect(names).toContain(fx.teacherA.name); // same district
    expect(names).not.toContain(fx.teacherB.name); // different district
  });

  test('a teacher cannot delete another teacher\'s query', async () => {
    const res = await request(app)
      .delete(`/api/queries/${fx.queryB.id}`)
      .set('Authorization', `Bearer ${teacherAToken}`);
    expect(res.status).toBe(403);

    // Confirm it genuinely wasn't deleted.
    const stillThere = await prisma.query.findUnique({ where: { id: fx.queryB.id } });
    expect(stillThere).not.toBeNull();
  });

  test('a teacher cannot submit feedback on another teacher\'s query', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .send({ queryId: fx.queryB.id, rating: 'helpful' });
    expect(res.status).toBe(403);
  });

  test('a teacher CAN delete their own query', async () => {
    const res = await request(app)
      .delete(`/api/queries/${fx.queryA.id}`)
      .set('Authorization', `Bearer ${teacherAToken}`);
    expect(res.status).toBe(200);

    const gone = await prisma.query.findUnique({ where: { id: fx.queryA.id } });
    expect(gone).toBeNull();
  });

  test('a teacher\'s own history never includes another school\'s questions', async () => {
    const res = await request(app)
      .get('/api/queries')
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(res.status).toBe(200);
    for (const q of res.body.queries) {
      expect(q.query.startsWith('tenant query from teacher B')).toBe(true);
    }
  });
});
