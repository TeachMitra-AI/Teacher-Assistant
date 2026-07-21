// My Library — resource CRUD, ownership scoping, cross-user isolation, and
// validation. Ownership must always come from the token; a resource that does
// not exist OR belongs to another user must return the same 404.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PIN } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

describe('My Library — /api/resources', () => {
  let fx;
  let teacherAToken;
  let teacherBToken;

  const asA = (req) => req.set('Authorization', `Bearer ${teacherAToken}`);
  const asB = (req) => req.set('Authorization', `Bearer ${teacherBToken}`);

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'resources');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, PIN);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, PIN);
  });

  // Keep tests independent: clear resources created by the two test teachers
  // between cases (fixtures for other suites live in the same throwaway DB).
  afterEach(async () => {
    await prisma.resource.deleteMany({
      where: { userId: { in: [fx.teacherA.id, fx.teacherB.id] } },
    });
  });

  async function createFor(token, overrides = {}) {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'lesson_plan', title: 'Fractions intro', content: 'Body', ...overrides });
    return res;
  }

  describe('authentication', () => {
    test('unauthenticated list is rejected', async () => {
      const res = await request(app).get('/api/resources');
      expect(res.status).toBe(401);
    });
    test('unauthenticated create is rejected', async () => {
      const res = await request(app).post('/api/resources').send({ title: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('create', () => {
    test('creates a resource owned by the caller', async () => {
      const res = await createFor(teacherAToken, {
        type: 'lesson_plan',
        title: 'Photosynthesis',
        grade: 'Class 6-8',
        subject: 'Science',
        language: 'en',
        content: '## Objectives\nExplain photosynthesis',
        structured: JSON.stringify({ duration: '40 min' }),
      });
      expect(res.status).toBe(201);
      expect(res.body.resource).toMatchObject({
        type: 'lesson_plan',
        title: 'Photosynthesis',
        grade: 'Class 6-8',
        subject: 'Science',
      });
      expect(res.body.resource.id).toBeTruthy();
      // The DTO must not leak ownership/internal columns.
      expect(res.body.resource).not.toHaveProperty('userId');
      expect(res.body.resource).not.toHaveProperty('schoolId');

      // Ownership persisted from the token.
      const row = await prisma.resource.findUnique({ where: { id: res.body.resource.id } });
      expect(row.userId).toBe(fx.teacherA.id);
      expect(row.schoolId).toBe(fx.schoolA.id);
    });

    test('defaults type to general and language to en', async () => {
      const res = await request(app)
        .post('/api/resources')
        .set('Authorization', `Bearer ${teacherAToken}`)
        .send({ title: 'Just a note' });
      expect(res.status).toBe(201);
      expect(res.body.resource.type).toBe('general');
      expect(res.body.resource.language).toBe('en');
    });

    test('IGNORES a client-supplied userId — ownership comes from the token', async () => {
      const res = await request(app)
        .post('/api/resources')
        .set('Authorization', `Bearer ${teacherAToken}`)
        .send({ title: 'Spoof attempt', userId: fx.teacherB.id });
      // .strict() schema rejects the unknown key outright (defense in depth).
      expect(res.status).toBe(400);

      // And even if it were accepted, nothing should have been created for B.
      const bRows = await prisma.resource.findMany({ where: { userId: fx.teacherB.id } });
      expect(bRows).toHaveLength(0);
    });

    test('rejects an empty title', async () => {
      const res = await createFor(teacherAToken, { title: '' });
      expect(res.status).toBe(400);
    });

    test('rejects an unknown type', async () => {
      const res = await createFor(teacherAToken, { type: 'malware' });
      expect(res.status).toBe(400);
    });

    test('rejects content over the max length', async () => {
      const res = await createFor(teacherAToken, { content: 'x'.repeat(50001) });
      expect(res.status).toBe(400);
    });
  });

  describe('list, filter, search', () => {
    beforeEach(async () => {
      await createFor(teacherAToken, { type: 'lesson_plan', title: 'Algebra basics', content: 'equations' });
      await createFor(teacherAToken, { type: 'assessment', title: 'Weekly quiz', content: 'ten questions' });
      await createFor(teacherAToken, { type: 'explanation', title: 'Gravity explained', content: 'apples fall' });
    });

    test('returns only the caller’s resources', async () => {
      await createFor(teacherBToken, { title: 'B private plan' });
      const res = await asA(request(app).get('/api/resources'));
      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(3);
      expect(res.body.resources.every((r) => r.title !== 'B private plan')).toBe(true);
    });

    test('filters by type', async () => {
      const res = await asA(request(app).get('/api/resources?type=assessment'));
      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
      expect(res.body.resources[0].title).toBe('Weekly quiz');
    });

    test('ignores an invalid type filter (returns all)', async () => {
      const res = await asA(request(app).get('/api/resources?type=bogus'));
      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(3);
    });

    test('searches title and content', async () => {
      const byTitle = await asA(request(app).get('/api/resources?q=algebra'));
      expect(byTitle.body.resources).toHaveLength(1);
      expect(byTitle.body.resources[0].title).toBe('Algebra basics');

      const byContent = await asA(request(app).get('/api/resources?q=apples'));
      expect(byContent.body.resources).toHaveLength(1);
      expect(byContent.body.resources[0].title).toBe('Gravity explained');
    });
  });

  describe('get one', () => {
    test('owner can fetch their resource', async () => {
      const created = await createFor(teacherAToken, { title: 'Owned' });
      const res = await asA(request(app).get(`/api/resources/${created.body.resource.id}`));
      expect(res.status).toBe(200);
      expect(res.body.resource.title).toBe('Owned');
    });

    test('non-existent id returns 404', async () => {
      const res = await asA(request(app).get('/api/resources/does-not-exist'));
      expect(res.status).toBe(404);
    });

    test('another user’s resource returns 404 (existence not leaked)', async () => {
      const created = await createFor(teacherAToken, { title: 'A private' });
      const res = await asB(request(app).get(`/api/resources/${created.body.resource.id}`));
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    test('owner can update fields', async () => {
      const created = await createFor(teacherAToken, { title: 'Draft' });
      const res = await asA(
        request(app).patch(`/api/resources/${created.body.resource.id}`).send({ title: 'Final', content: 'updated' })
      );
      expect(res.status).toBe(200);
      expect(res.body.resource.title).toBe('Final');
      expect(res.body.resource.content).toBe('updated');
    });

    test('another user cannot update — returns 404 and leaves data intact', async () => {
      const created = await createFor(teacherAToken, { title: 'A original' });
      const res = await asB(
        request(app).patch(`/api/resources/${created.body.resource.id}`).send({ title: 'Hacked' })
      );
      expect(res.status).toBe(404);

      const row = await prisma.resource.findUnique({ where: { id: created.body.resource.id } });
      expect(row.title).toBe('A original');
    });

    test('empty update payload is rejected', async () => {
      const created = await createFor(teacherAToken, { title: 'Draft' });
      const res = await asA(request(app).patch(`/api/resources/${created.body.resource.id}`).send({}));
      expect(res.status).toBe(400);
    });

    test('unknown field in update is rejected', async () => {
      const created = await createFor(teacherAToken, { title: 'Draft' });
      const res = await asA(
        request(app).patch(`/api/resources/${created.body.resource.id}`).send({ userId: fx.teacherB.id })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('delete', () => {
    test('owner can delete their resource', async () => {
      const created = await createFor(teacherAToken, { title: 'To delete' });
      const res = await asA(request(app).delete(`/api/resources/${created.body.resource.id}`));
      expect(res.status).toBe(200);
      const row = await prisma.resource.findUnique({ where: { id: created.body.resource.id } });
      expect(row).toBeNull();
    });

    test('another user cannot delete — returns 404 and leaves data intact', async () => {
      const created = await createFor(teacherAToken, { title: 'A keep' });
      const res = await asB(request(app).delete(`/api/resources/${created.body.resource.id}`));
      expect(res.status).toBe(404);
      const row = await prisma.resource.findUnique({ where: { id: created.body.resource.id } });
      expect(row).not.toBeNull();
    });

    test('deleting a non-existent id returns 404', async () => {
      const res = await asA(request(app).delete('/api/resources/nope'));
      expect(res.status).toBe(404);
    });
  });

  // Lesson Plan Workspace AI actions. Ownership must be enforced exactly like
  // the rest of the resource routes; the suggestion is returned but never
  // persisted (saving stays an explicit PATCH). Gemini's fetch is mocked so
  // the real route + GeminiService run end-to-end without a network call.
  describe('ai-action — POST /api/resources/:id/ai-action', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/resources/whatever/ai-action').send({ action: 'simplify' });
      expect(res.status).toBe(401);
    });

    test('owner gets a suggestion without the resource being modified', async () => {
      mockGeminiFetch([geminiSuccess('# Simpler version\nEasy words here.')]);
      const created = await createFor(teacherAToken, { title: 'Fractions', content: 'Original body' });
      const id = created.body.resource.id;

      const res = await asA(request(app).post(`/api/resources/${id}/ai-action`).send({ action: 'simplify' }));
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toContain('Simpler version');
      expect(typeof res.body.requestId).toBe('string');

      // The stored resource content is untouched — suggestions are not saved.
      const row = await prisma.resource.findUnique({ where: { id } });
      expect(row.content).toBe('Original body');
    });

    test('another user cannot run an AI action — returns 404 (existence not leaked)', async () => {
      mockGeminiFetch([geminiSuccess('should never be reached')]);
      const created = await createFor(teacherAToken, { title: 'A private', content: 'secret' });
      const res = await asB(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`).send({ action: 'simplify' })
      );
      expect(res.status).toBe(404);
    });

    test('non-existent id returns 404', async () => {
      mockGeminiFetch([geminiSuccess('nope')]);
      const res = await asA(request(app).post('/api/resources/does-not-exist/ai-action').send({ action: 'simplify' }));
      expect(res.status).toBe(404);
    });

    test('rejects an unknown action', async () => {
      const created = await createFor(teacherAToken, { title: 'Draft' });
      const res = await asA(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`).send({ action: 'delete_everything' })
      );
      expect(res.status).toBe(400);
    });

    test('adapt_grade without a target grade is rejected', async () => {
      const created = await createFor(teacherAToken, { title: 'Draft' });
      const res = await asA(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`).send({ action: 'adapt_grade' })
      );
      expect(res.status).toBe(400);
    });
  });
});
