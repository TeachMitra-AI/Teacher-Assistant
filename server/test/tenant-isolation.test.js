// Highest-value regression protection identified in the audit: a bug in
// schoolScope() or an ownership check would leak one school's/teacher's
// data to another. These tests assert that never happens.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('tenant isolation', () => {
  let fx;
  let schoolAdminAToken;
  let resourcePersonAToken;
  let teacherAToken;
  let teacherBToken;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'tenant');
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, PASSWORD);
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, PASSWORD);
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

  // Approval endpoints are the newest way one school's admin could reach into
  // another school's accounts, so they get the same scoping assertions as
  // every other admin route.
  describe('pending sign-ups', () => {
    let pendingA;
    let pendingB;

    beforeAll(async () => {
      const make = (schoolId, slug) =>
        prisma.user.create({
          data: {
            schoolId,
            name: `Pending ${slug}`,
            email: `tenant-pending-${slug}@example.com`,
            role: 'teacher',
            status: 'pending',
            passwordHash: 'not-used-by-these-tests',
          },
        });
      pendingA = await make(fx.schoolA.id, 'a');
      pendingB = await make(fx.schoolB.id, 'b');
    });

    test('school_admin only ever sees pending sign-ups from their own school', async () => {
      const res = await request(app)
        .get('/api/admin/users/pending')
        .set('Authorization', `Bearer ${schoolAdminAToken}`);
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      expect(emails).toContain(pendingA.email);
      expect(emails).not.toContain(pendingB.email);
    });

    test('resource_person sees their own district\'s pending sign-ups but not another district\'s', async () => {
      const res = await request(app)
        .get('/api/admin/users/pending')
        .set('Authorization', `Bearer ${resourcePersonAToken}`);
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      expect(emails).toContain(pendingA.email); // same district
      expect(emails).not.toContain(pendingB.email); // different district
    });

    test('school_admin cannot approve a pending sign-up at another school', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${pendingB.id}/approve`)
        .set('Authorization', `Bearer ${schoolAdminAToken}`);
      expect(res.status).toBe(403);

      // Confirm the cross-school account genuinely wasn't let in.
      const stillPending = await prisma.user.findUnique({ where: { id: pendingB.id } });
      expect(stillPending.status).toBe('pending');
    });

    test('school_admin cannot reject a pending sign-up at another school', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${pendingB.id}/reject`)
        .set('Authorization', `Bearer ${schoolAdminAToken}`);
      expect(res.status).toBe(403);

      const stillPending = await prisma.user.findUnique({ where: { id: pendingB.id } });
      expect(stillPending.status).toBe('pending');
    });

    test('school_admin CAN approve a pending sign-up at their own school', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${pendingA.id}/approve`)
        .set('Authorization', `Bearer ${schoolAdminAToken}`);
      expect(res.status).toBe(200);

      const approved = await prisma.user.findUnique({ where: { id: pendingA.id } });
      expect(approved.status).toBe('active');
    });
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
