// Admin Support Inbox (Phase 2) — GET/PATCH/POST /api/admin/support/tickets*.
// Every route is super_admin-only, full stop (unlike routes/admin.js's other
// endpoints, which resource_person/school_admin can also reach in a narrower
// scope) — so the access-control tests here check that the OTHER two admin
// roles are rejected just as firmly as a plain teacher.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

describe('Admin Support Inbox', () => {
  let fx;
  let superAdminToken;
  let schoolAdminAToken;
  let resourcePersonAToken;
  let teacherAToken;
  let bugTicket;
  let feedbackTicket;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'asup');
    superAdminToken = await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD);
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, PASSWORD);
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);

    bugTicket = await prisma.supportTicket.create({
      data: {
        type: 'bug',
        category: 'slow_timeout',
        description: 'asup marker: the read-aloud button did not stop',
        status: 'open',
        userId: fx.teacherA.id,
        schoolId: fx.schoolA.id,
        context: JSON.stringify({ route: '/', theme: 'dark' }),
      },
    });
    feedbackTicket = await prisma.supportTicket.create({
      data: {
        type: 'feedback',
        category: 'suggestion',
        description: 'asup marker: add a Bengali keyboard',
        status: 'resolved',
        userId: fx.teacherB.id,
        schoolId: fx.schoolB.id,
      },
    });
  });

  function asSuper(req) {
    return req.set('Authorization', `Bearer ${superAdminToken}`);
  }

  describe('access control', () => {
    test('requires a token', async () => {
      const res = await request(app).get('/api/admin/support/tickets');
      expect(res.status).toBe(401);
    });

    test.each([
      ['school_admin', () => schoolAdminAToken],
      ['resource_person', () => resourcePersonAToken],
      ['teacher', () => teacherAToken],
    ])('rejects %s with 403 — this is super_admin-only, unlike other admin routes', async (_label, getToken) => {
      const res = await request(app)
        .get('/api/admin/support/tickets')
        .set('Authorization', `Bearer ${getToken()}`);
      expect(res.status).toBe(403);
    });

    test('super_admin is let through', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets'));
      expect(res.status).toBe(200);
    });
  });

  describe('GET /tickets — list, filter, search', () => {
    test('lists tickets newest first with total/page/limit', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?limit=100'));
      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(bugTicket.id);
      expect(ids).toContain(feedbackTicket.id);
    });

    test('caps an absurd limit at 100', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?limit=100000'));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    test('filters by status', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?status=resolved&limit=100'));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(feedbackTicket.id);
      expect(ids).not.toContain(bugTicket.id);
    });

    test('filters by type', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?type=bug&limit=100'));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(bugTicket.id);
      expect(ids).not.toContain(feedbackTicket.id);
    });

    test('an invalid status/type is ignored rather than erroring', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?status=not_a_real_status&limit=100'));
      expect(res.status).toBe(200);
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(bugTicket.id); // unfiltered, since the bad value was dropped
    });

    test('filters by category', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?category=suggestion&limit=100'));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(feedbackTicket.id);
      expect(ids).not.toContain(bugTicket.id);
    });

    test('filters by schoolId', async () => {
      const res = await asSuper(request(app).get(`/api/admin/support/tickets?schoolId=${fx.schoolB.id}&limit=100`));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(feedbackTicket.id);
      expect(ids).not.toContain(bugTicket.id);
    });

    test('searches description text', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets?q=Bengali+keyboard&limit=100'));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toEqual([feedbackTicket.id]);
    });

    test('searches by the short reference shown to the teacher (endsWith the id)', async () => {
      const shortRef = bugTicket.id.slice(-8);
      const res = await asSuper(request(app).get(`/api/admin/support/tickets?q=${shortRef}&limit=100`));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toEqual([bugTicket.id]);
    });

    test('searches by reporter name', async () => {
      const res = await asSuper(request(app).get(`/api/admin/support/tickets?q=${encodeURIComponent(fx.teacherB.name)}&limit=100`));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).toContain(feedbackTicket.id);
    });

    test('filters by a createdAt date range', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const res = await asSuper(request(app).get(`/api/admin/support/tickets?from=${future}&limit=100`));
      const ids = res.body.tickets.map((t) => t.id);
      expect(ids).not.toContain(bugTicket.id);
      expect(ids).not.toContain(feedbackTicket.id);
    });
  });

  describe('GET /tickets/stats', () => {
    test('returns open/today/bugs/feedback counts', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets/stats'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          open: expect.any(Number),
          today: expect.any(Number),
          bugs: expect.any(Number),
          feedback: expect.any(Number),
        })
      );
      expect(res.body.bugs).toBeGreaterThanOrEqual(1);
      expect(res.body.feedback).toBeGreaterThanOrEqual(1);
    });

    test('is not shadowed by the /:id route (a literal "stats" id would 404, not match)', async () => {
      // If routing order were wrong, GET /tickets/stats would be captured by
      // GET /tickets/:id instead and return a 404 "ticket not found" shape.
      // Asserting the actual stats shape here catches that regression.
      const res = await asSuper(request(app).get('/api/admin/support/tickets/stats'));
      expect(res.body.open).not.toBeUndefined();
    });
  });

  describe('GET /tickets/:id', () => {
    test('returns full detail including parsed context and an empty notes array', async () => {
      const res = await asSuper(request(app).get(`/api/admin/support/tickets/${bugTicket.id}`));
      expect(res.status).toBe(200);
      expect(res.body.ticket.id).toBe(bugTicket.id);
      expect(res.body.ticket.context).toEqual({ route: '/', theme: 'dark' });
      expect(res.body.ticket.user.email).toBe(fx.teacherA.email);
      expect(res.body.ticket.school.code).toBe(fx.schoolA.code);
      expect(res.body.ticket.notes).toEqual([]);
    });

    test('404s for a ticket that does not exist', async () => {
      const res = await asSuper(request(app).get('/api/admin/support/tickets/not-a-real-id'));
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /tickets/:id/status', () => {
    test('updates the status', async () => {
      const res = await asSuper(
        request(app).patch(`/api/admin/support/tickets/${feedbackTicket.id}/status`).send({ status: 'wont_fix' })
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('wont_fix');

      const reread = await prisma.supportTicket.findUnique({ where: { id: feedbackTicket.id } });
      expect(reread.status).toBe('wont_fix');

      // Restore for any later test in this file that assumes 'resolved'.
      await prisma.supportTicket.update({ where: { id: feedbackTicket.id }, data: { status: 'resolved' } });
    });

    test('rejects an invalid status', async () => {
      const res = await asSuper(
        request(app).patch(`/api/admin/support/tickets/${bugTicket.id}/status`).send({ status: 'archived' })
      );
      expect(res.status).toBe(400);
    });

    test('404s for a ticket that does not exist', async () => {
      const res = await asSuper(
        request(app).patch('/api/admin/support/tickets/not-a-real-id/status').send({ status: 'triaged' })
      );
      expect(res.status).toBe(404);
    });

    test('a school_admin cannot change status', async () => {
      const res = await request(app)
        .patch(`/api/admin/support/tickets/${bugTicket.id}/status`)
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({ status: 'triaged' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /tickets/:id/notes', () => {
    test('adds a note authored by the caller', async () => {
      const res = await asSuper(
        request(app).post(`/api/admin/support/tickets/${bugTicket.id}/notes`).send({ body: 'Reproduced on Firefox too.' })
      );
      expect(res.status).toBe(201);
      expect(res.body.note.body).toBe('Reproduced on Firefox too.');
      expect(res.body.note.author.email).toBe(fx.superAdmin.email);

      const detail = await asSuper(request(app).get(`/api/admin/support/tickets/${bugTicket.id}`));
      expect(detail.body.ticket.notes).toHaveLength(1);
      expect(detail.body.ticket.notes[0].body).toBe('Reproduced on Firefox too.');
    });

    test('rejects an empty note', async () => {
      const res = await asSuper(request(app).post(`/api/admin/support/tickets/${bugTicket.id}/notes`).send({ body: '   ' }));
      expect(res.status).toBe(400);
    });

    test('404s for a ticket that does not exist', async () => {
      const res = await asSuper(
        request(app).post('/api/admin/support/tickets/not-a-real-id/notes').send({ body: 'hello' })
      );
      expect(res.status).toBe(404);
    });

    test('never appears on any teacher-facing endpoint', async () => {
      // There is no route a teacher can call that returns SupportNote rows —
      // asserting the negative directly on the one endpoint a teacher CAN
      // reach for their own history.
      const res = await request(app)
        .get('/api/queries')
        .set('Authorization', `Bearer ${teacherAToken}`);
      expect(JSON.stringify(res.body)).not.toMatch(/Reproduced on Firefox/);
    });
  });
});
