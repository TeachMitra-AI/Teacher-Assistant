// My Library — resource CRUD, ownership scoping, cross-user isolation, and
// validation. Ownership must always come from the token; a resource that does
// not exist OR belongs to another user must return the same 404.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
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
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, PASSWORD);
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

  // Notification System system-hook (docs/notification-system-plan.md §6):
  // saving a resource is the "lesson generated"/"assessment ready" system
  // event. A sibling describe block, not folded into 'create' above — it
  // exercises a different subsystem (Notification, not Resource) as a
  // side-effect of the same endpoint.
  describe('notification hook on save', () => {
    let savedEnv;
    beforeAll(() => { savedEnv = process.env.NOTIFICATIONS_ENABLED; process.env.NOTIFICATIONS_ENABLED = 'true'; });
    afterAll(() => {
      if (savedEnv === undefined) delete process.env.NOTIFICATIONS_ENABLED;
      else process.env.NOTIFICATIONS_ENABLED = savedEnv;
    });
    afterEach(async () => {
      await prisma.notification.deleteMany({ where: { recipientId: { in: [fx.teacherA.id, fx.teacherB.id] } } });
    });

    test('creates exactly one lesson_generated notification for the owner, linking to the saved resource', async () => {
      const res = await createFor(teacherAToken, { type: 'lesson_plan', title: 'Fractions intro' });
      expect(res.status).toBe(201);

      const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('lesson_generated');
      expect(rows[0].link).toBe(`/library/${res.body.resource.id}`);
    });

    test('creates an assessment_ready notification for an assessment-type resource', async () => {
      const res = await createFor(teacherAToken, { type: 'assessment', title: 'Unit 3 quiz' });
      expect(res.status).toBe(201);

      const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('assessment_ready');
    });

    test('creates no row while NOTIFICATIONS_ENABLED is off', async () => {
      process.env.NOTIFICATIONS_ENABLED = 'false';
      try {
        const res = await createFor(teacherAToken, { title: 'Should not notify' });
        expect(res.status).toBe(201);
        const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id } });
        expect(rows).toHaveLength(0);
      } finally {
        process.env.NOTIFICATIONS_ENABLED = 'true';
      }
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

    // Classroom Mode asks "what did this turn already save?" so a set reopened
    // from history shows its cards as Saved instead of offering to save the
    // same quiz twice (nothing deduplicates on create).
    describe('sourceQueryId filter', () => {
      test('returns only resources saved from that turn', async () => {
        await createFor(teacherAToken, { title: 'Quiz from turn 1', sourceQueryId: 'query-one' });
        await createFor(teacherAToken, { title: 'Quiz from turn 2', sourceQueryId: 'query-two' });

        const res = await asA(request(app).get('/api/resources?sourceQueryId=query-one'));
        expect(res.status).toBe(200);
        expect(res.body.resources).toHaveLength(1);
        expect(res.body.resources[0].title).toBe('Quiz from turn 1');
        expect(res.body.resources[0].sourceQueryId).toBe('query-one');
      });

      test('a turn that saved nothing returns an empty list', async () => {
        const res = await asA(request(app).get('/api/resources?sourceQueryId=never-saved'));
        expect(res.status).toBe(200);
        expect(res.body.resources).toHaveLength(0);
      });

      // The filter narrows the caller's own library — it can never widen it
      // into someone else's, however the id was obtained.
      test('cannot reach another user’s resources', async () => {
        await createFor(teacherBToken, { title: 'B saved this', sourceQueryId: 'shared-id' });
        const res = await asA(request(app).get('/api/resources?sourceQueryId=shared-id'));
        expect(res.status).toBe(200);
        expect(res.body.resources).toHaveLength(0);
      });

      test('an empty sourceQueryId is ignored rather than matching everything', async () => {
        const res = await asA(request(app).get('/api/resources?sourceQueryId='));
        expect(res.status).toBe(200);
        expect(res.body.resources).toHaveLength(3);
      });
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

    test("another user cannot run an assessment action — returns 404", async () => {
      mockGeminiFetch([geminiSuccess('should never be reached')]);
      const created = await createFor(teacherAToken, { type: 'assessment', title: 'A quiz' });
      const res = await asB(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`).send({ action: 'more_questions' })
      );
      expect(res.status).toBe(404);
    });
  });

  // Phase 4: make_easier / make_harder / more_questions / simplify_wording go
  // through the SAME structured JSON pipeline as initial generation — parse
  // the resource's current content back into { instructions, questions },
  // ask Gemini for a JSON revision, validate it, and re-render deterministically
  // onto the ORIGINAL title/metadata preamble (never regenerated, never sent
  // to the model). See handleAssessmentAction/parseAssessmentBody in
  // server/src/routes/resources.js.
  describe('assessment AI-assist actions — structured pipeline (Phase 4)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // Exactly what renderAssessmentMarkdown/renderAssessmentBody would
    // produce for a mixed-type 3-question quiz — the shape parseAssessmentBody
    // must recover losslessly.
    const VALID_QUIZ_CONTENT = [
      '# Science Quiz: Photosynthesis',
      '',
      '**Grade:** Class 6-8',
      '**Subject:** Science',
      '**Topic:** Photosynthesis',
      '**Difficulty:** medium',
      '',
      '## Instructions',
      '',
      'Answer all questions carefully.',
      '',
      '## Questions',
      '',
      '1. What do plants need for photosynthesis?',
      'A. Water only',
      'B. Sunlight only',
      'C. Water, sunlight, and carbon dioxide',
      'D. Soil only',
      '',
      '2. Photosynthesis occurs in the leaves. — (True / False)',
      '',
      '3. Name the green pigment in plants.',
      '',
      '## Answer Key',
      '',
      '1. C',
      '2. True',
      '3. Chlorophyll',
    ].join('\n');

    const VALID_WORKSHEET_CONTENT = VALID_QUIZ_CONTENT.replace('## Answer Key', '## Teacher Answer Key');

    function mcq(text, correctOptionIndex = 0) {
      return { type: 'mcq', text, options: ['Opt A', 'Opt B', 'Opt C', 'Opt D'], correctOptionIndex, correctAnswer: '' };
    }
    function trueFalse(text, correctAnswer = 'True') {
      return { type: 'true_false', text, options: [], correctOptionIndex: -1, correctAnswer };
    }
    function shortAnswer(text, correctAnswer = 'Some answer') {
      return { type: 'short_answer', text, options: [], correctOptionIndex: -1, correctAnswer };
    }

    async function createQuiz(token, content = VALID_QUIZ_CONTENT) {
      const res = await request(app)
        .post('/api/resources')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'assessment',
          title: 'Science Quiz: Photosynthesis',
          grade: 'Class 6-8',
          subject: 'Science',
          content,
          structured: JSON.stringify({
            format: 'quiz', difficulty: 'medium', questionType: 'mixed', questionCount: 3, topic: 'Photosynthesis',
            examMeta: { schoolName: 'Test School', examName: 'Unit Test 1', maxMarks: '20' },
          }),
        });
      return res.body.resource;
    }

    const runAction = (token, id, body) =>
      request(app).post(`/api/resources/${id}/ai-action`).set('Authorization', `Bearer ${token}`).send(body);

    test('make_harder: replaces all 3 questions with the same count/types, preamble and letterhead untouched', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess(JSON.stringify({
        instructions: 'Answer all questions carefully, showing your reasoning.',
        questions: [mcq('Harder Q1?', 2), trueFalse('Harder Q2.', 'False'), shortAnswer('Harder Q3?', 'Xanthophyll')],
      }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_harder' });
      expect(res.status).toBe(200);
      const { suggestion } = res.body;

      // Title/metadata preamble preserved byte-for-byte from the original.
      expect(suggestion).toContain('# Science Quiz: Photosynthesis');
      expect(suggestion).toContain('**Grade:** Class 6-8');
      expect(suggestion).toContain('**Topic:** Photosynthesis');

      // New content, sequential numbering, canonical answer-key heading.
      expect(suggestion).toMatch(/1\. Harder Q1\?/);
      expect(suggestion).toContain('C. Opt C'); // correctOptionIndex 2 -> "C"
      expect(suggestion).toMatch(/2\. Harder Q2\. — \(True \/ False\)/);
      expect(suggestion).toContain('3. Harder Q3?');
      expect(suggestion).toMatch(/## Answer Key[\s\S]*1\. C[\s\S]*2\. False[\s\S]*3\. Xanthophyll/);

      // Resource.structured (Phase 3 examMeta) is never touched by an ai-action
      // suggestion — it isn't even persisted here (saving is a separate PATCH).
      const row = await prisma.resource.findUnique({ where: { id: resource.id } });
      expect(row.content).toBe(VALID_QUIZ_CONTENT); // unchanged until Save
      expect(JSON.parse(row.structured).examMeta.schoolName).toBe('Test School');
    });

    test('make_easier: same contract as make_harder, worksheet format keeps "Teacher Answer Key" heading', async () => {
      const resource = await createQuiz(teacherAToken, VALID_WORKSHEET_CONTENT);
      mockGeminiFetch([geminiSuccess(JSON.stringify({
        instructions: 'Answer all questions.',
        questions: [mcq('Easier Q1?', 0), trueFalse('Easier Q2.', 'True'), shortAnswer('Easier Q3?', 'Chlorophyll')],
      }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_easier' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toContain('## Teacher Answer Key');
      expect(res.body.suggestion).not.toContain('## Answer Key\n'); // not the quiz heading
    });

    test('simplify_wording: rejects a response that changes a correct answer', async () => {
      const resource = await createQuiz(teacherAToken);
      // Original Q1 correctOptionIndex is 2 (C); this response moves it to 0 (A).
      mockGeminiFetch([geminiSuccess(JSON.stringify({
        instructions: 'Answer all questions carefully.',
        questions: [mcq('What do plants need for photosynthesis (simpler)?', 0), trueFalse('Photosynthesis happens in leaves.', 'True'), shortAnswer('Name the green pigment.', 'Chlorophyll')],
      }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'simplify_wording' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('INVALID_AI_RESPONSE');
    });

    test('simplify_wording: accepts a response that preserves every answer exactly', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess(JSON.stringify({
        instructions: 'Answer all questions carefully.',
        questions: [mcq('What do plants need for photosynthesis (simpler)?', 2), trueFalse('Photosynthesis happens in leaves.', 'True'), shortAnswer('Name the green pigment.', 'Chlorophyll')],
      }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'simplify_wording' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toContain('What do plants need for photosynthesis (simpler)?');
    });

    test('more_questions: appends exactly 5 new questions, keeping the existing 3 byte-identical', async () => {
      const resource = await createQuiz(teacherAToken);
      const newOnes = Array.from({ length: 5 }, (_, i) => mcq(`New question ${i + 1}?`, 1));
      mockGeminiFetch([geminiSuccess(JSON.stringify({ instructions: 'Answer all questions carefully.', questions: newOnes }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'more_questions' });
      expect(res.status).toBe(200);
      const { suggestion } = res.body;

      // Existing 3 questions preserved verbatim (never round-tripped through the model).
      expect(suggestion).toContain('1. What do plants need for photosynthesis?');
      expect(suggestion).toContain('A. Water only');
      expect(suggestion).toMatch(/2\. Photosynthesis occurs in the leaves\. — \(True \/ False\)/);
      expect(suggestion).toContain('3. Name the green pigment in plants.');

      // Exactly 5 new ones appended, numbered 4-8.
      for (let i = 4; i <= 8; i++) expect(suggestion).toContain(`${i}. New question ${i - 3}?`);
      const qMatches = [...suggestion.matchAll(/^(\d+)\.\s/gm)];
      expect(qMatches).toHaveLength(16); // 8 questions + 8 answer-key lines

      // Answer key extended to cover all 8, original 3 answers unchanged.
      expect(suggestion).toMatch(/## Answer Key[\s\S]*1\. C[\s\S]*2\. True[\s\S]*3\. Chlorophyll[\s\S]*4\. B/);
    });

    test('more_questions: rejects a response with the wrong number of new questions', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess(JSON.stringify({ instructions: 'x', questions: [mcq('Only one?', 0)] }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'more_questions' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('INVALID_AI_RESPONSE');
    });

    test('more_questions: refuses to exceed the 30-question maximum without calling Gemini', async () => {
      const manyQuestions = Array.from({ length: 28 }, (_, i) => `${i + 1}. Q${i + 1}?\n`).join('\n');
      const content = [
        '# Big Quiz', '', '**Grade:** Class 6-8', '**Subject:** Science', '**Topic:** X', '**Difficulty:** medium', '',
        '## Instructions', '', 'Go.', '', '## Questions', '', manyQuestions,
        '## Answer Key', '', ...Array.from({ length: 28 }, (_, i) => `${i + 1}. Answer${i + 1}`),
      ].join('\n');
      const resource = await createQuiz(teacherAToken, content);
      const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

      const res = await runAction(teacherAToken, resource.id, { action: 'more_questions' });
      expect(res.status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    });

    test('rejects a make_harder response with a mismatched question count', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess(JSON.stringify({ instructions: 'x', questions: [mcq('Only one?', 0), mcq('Two?', 1)] }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_harder' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('INVALID_AI_RESPONSE');
    });

    test('rejects a response that changes a question\'s type', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess(JSON.stringify({
        instructions: 'x',
        // Q1 was mcq, now returned as short_answer — not allowed.
        questions: [shortAnswer('Now short answer?', 'x'), trueFalse('Q2.', 'True'), shortAnswer('Q3?', 'Chlorophyll')],
      }))]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_harder' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('INVALID_AI_RESPONSE');
    });

    test('rejects non-JSON AI output for a structured action', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess('# Not JSON at all\nJust markdown.')]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_easier' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('INVALID_AI_RESPONSE');
    });

    test('fails safely (422) on a resource whose content no longer matches the expected shape', async () => {
      const resource = await createQuiz(teacherAToken, 'Just some free text, not a real quiz document.');
      const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_easier' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNPARSEABLE_CONTENT');
      expect(mock).not.toHaveBeenCalled();

      // Never touches the saved resource.
      const row = await prisma.resource.findUnique({ where: { id: resource.id } });
      expect(row.content).toBe('Just some free text, not a real quiz document.');
    });

    test('rejects an mcq answer key entry that is not a valid option letter', async () => {
      const badContent = VALID_QUIZ_CONTENT.replace('1. C\n2. True', '1. Z\n2. True');
      const resource = await createQuiz(teacherAToken, badContent);
      const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

      const res = await runAction(teacherAToken, resource.id, { action: 'make_easier' });
      expect(res.status).toBe(422);
      expect(mock).not.toHaveBeenCalled();
    });

    test('assessment actions are rejected for a non-assessment resource type', async () => {
      const created = await createFor(teacherAToken, { type: 'lesson_plan', content: VALID_QUIZ_CONTENT });
      const res = await asA(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`).send({ action: 'make_easier' })
      );
      expect(res.status).toBe(400);
    });

    test('generic actions (e.g. simplify) still use the old Markdown passthrough, unaffected by Phase 4', async () => {
      const resource = await createQuiz(teacherAToken);
      mockGeminiFetch([geminiSuccess('# Simplified\nEasy words.')]);
      const res = await runAction(teacherAToken, resource.id, { action: 'simplify' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toBe('# Simplified\nEasy words.');
    });

    // Structured Question Model (Generator v2, plan §2f): a resource with
    // native structured questions reads/writes `structured` directly and
    // skips parseAssessmentBody's regex round-trip entirely.
    describe('structured resources (schemaVersion 2) skip the regex round-trip', () => {
      async function createStructuredQuiz(token) {
        const res = await request(app).post('/api/resources').set('Authorization', `Bearer ${token}`).send({
          type: 'assessment',
          title: 'Fractions Quiz',
          grade: 'Class 5',
          subject: 'Maths',
          structured: JSON.stringify({
            schemaVersion: 2,
            format: 'quiz', topic: 'Fractions', grade: 'Class 5', subject: 'Maths', difficulty: 'medium',
            instructions: 'Answer all questions carefully.',
            questions: [mcq('What is 1/2 + 1/2?', 0), trueFalse('1/2 > 1/4.', 'True'), shortAnswer('Define a fraction.', 'A part of a whole.')],
          }),
        });
        return res.body.resource;
      }

      test('make_harder succeeds even when `content` has been corrupted beyond regex-parsing', async () => {
        const resource = await createStructuredQuiz(teacherAToken);

        // Corrupt content directly (bypassing the API) so parseAssessmentBody
        // would fail — proving the ai-action below reads structured.questions
        // instead, never falling back to (or needing) a parseable `content`.
        await prisma.resource.update({ where: { id: resource.id }, data: { content: 'not parseable at all, no headings' } });

        mockGeminiFetch([geminiSuccess(JSON.stringify({
          instructions: 'Answer all questions carefully, showing your reasoning.',
          questions: [mcq('Harder Q1?', 1), trueFalse('Harder Q2.', 'False'), shortAnswer('Harder Q3?', 'A ratio of two integers.')],
        }))]);

        const res = await runAction(teacherAToken, resource.id, { action: 'make_harder' });
        expect(res.status).toBe(200);
        expect(res.body.suggestion).toContain('# Maths Quiz: Fractions');
        expect(res.body.suggestion).toMatch(/1\. Harder Q1\?/);

        const structured = JSON.parse(res.body.structured);
        expect(structured.schemaVersion).toBe(2);
        expect(structured.questions).toHaveLength(3);
        expect(structured.questions[0].text).toBe('Harder Q1?');
        // Generator-config keys (format/topic/grade/subject/difficulty) survive
        // the round trip untouched — only instructions/questions changed.
        expect(structured.topic).toBe('Fractions');

        // Never persisted by ai-action itself — same "preview only" contract
        // as the legacy path; the teacher must Save (PATCH) to apply it.
        const row = await prisma.resource.findUnique({ where: { id: resource.id } });
        expect(row.content).toBe('not parseable at all, no headings');
      });

      test('more_questions appends to the existing structured questions and updates the count', async () => {
        const resource = await createStructuredQuiz(teacherAToken);
        const newOnes = Array.from({ length: 5 }, (_, i) => shortAnswer(`New Q${i + 1}?`, `A${i + 1}`));
        mockGeminiFetch([geminiSuccess(JSON.stringify({ instructions: 'x', questions: newOnes }))]);

        const res = await runAction(teacherAToken, resource.id, { action: 'more_questions' });
        expect(res.status).toBe(200);
        const structured = JSON.parse(res.body.structured);
        expect(structured.questions).toHaveLength(8); // 3 original + 5 new
        expect(structured.questions[7].text).toBe('New Q5?');
      });
    });
  });

  // Quiz / Worksheet Generator. Builds a trusted prompt from a validated
  // config and asks Gemini for structured JSON question data (Phase 1 —
  // see server/src/lib/assessmentSchema.js), which the route validates,
  // normalizes, and renders into Markdown itself. It must NEVER persist a
  // resource itself (saving stays an explicit POST /api/resources). Gemini's
  // fetch is mocked so the real route + GeminiService run end-to-end
  // without a network call.
  describe('generate — POST /api/resources/generate', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const validConfig = {
      format: 'quiz',
      grade: 'Class 6-8',
      subject: 'Science',
      topic: 'Photosynthesis',
      difficulty: 'medium',
      questionType: 'mcq',
      questionCount: 5,
      language: 'en',
    };

    // Builds a schema-valid structured document matching `count` questions
    // of `type` (mirrors what buildGeneratorPrompt/ASSESSMENT_RESPONSE_SCHEMA
    // asks Gemini to return).
    function mockMcqQuestion(i) {
      return {
        type: 'mcq',
        text: `Question ${i}?`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctOptionIndex: i % 4,
        correctAnswer: '',
      };
    }
    function mockTrueFalseQuestion(i) {
      return {
        type: 'true_false',
        text: `Statement ${i}.`,
        options: [],
        correctOptionIndex: -1,
        correctAnswer: i % 2 === 0 ? 'True' : 'False',
      };
    }
    function mockShortAnswerQuestion(i) {
      return {
        type: 'short_answer',
        text: `Explain concept ${i}.`,
        options: [],
        correctOptionIndex: -1,
        correctAnswer: `Model answer ${i}.`,
      };
    }
    const QUESTION_BUILDERS = {
      mcq: mockMcqQuestion,
      true_false: mockTrueFalseQuestion,
      short_answer: mockShortAnswerQuestion,
    };
    function mockAssessmentDoc({ count, type }) {
      const builder = QUESTION_BUILDERS[type] || mockMcqQuestion;
      return {
        instructions: 'Answer all questions carefully.',
        questions: Array.from({ length: count }, (_, i) => builder(i + 1)),
      };
    }
    const mockAssessmentJsonResponse = (opts) => geminiSuccess(JSON.stringify(mockAssessmentDoc(opts)));

    const generate = (token, body) =>
      request(app).post('/api/resources/generate').set('Authorization', `Bearer ${token}`).send(body);

    test('requires authentication', async () => {
      const res = await request(app).post('/api/resources/generate').send(validConfig);
      expect(res.status).toBe(401);
    });

    test('valid request returns generated content and does NOT persist a resource', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 5, type: 'mcq' })]);
      const res = await generate(teacherAToken, validConfig);
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('Photosynthesis');
      expect(typeof res.body.requestId).toBe('string');

      // Nothing saved to the library by generation.
      const rows = await prisma.resource.findMany({ where: { userId: fx.teacherA.id } });
      expect(rows).toHaveLength(0);
    });

    test('renders deterministic numbering, MCQ option letters, and a canonical answer-key heading', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'mcq' })]);
      const res = await generate(teacherAToken, { ...validConfig, questionCount: 3 });
      expect(res.status).toBe(200);
      const { content } = res.body;

      // Sequential numbering, app-assigned — not sourced from the model.
      expect(content).toMatch(/## Questions[\s\S]*1\. Question 1\?/);
      expect(content).toMatch(/2\. Question 2\?/);
      expect(content).toMatch(/3\. Question 3\?/);
      // Options rendered as A–D on their own lines.
      expect(content).toMatch(/A\. Option A\nB\. Option B\nC\. Option C\nD\. Option D/);
      // Canonical, exact answer-key heading — guaranteed by the server now,
      // not dependent on the model reproducing it verbatim.
      expect(content).toContain('## Answer Key');
    });

    // The fixture strings use real JS escapes ('\t' = tab, '\f' = form feed) so
    // JSON.stringify re-emits them as the "\t"/"\f" JSON escapes Gemini
    // produces when it writes single-backslash LaTeX inside JSON — the exact
    // corruption observed in real generated papers ("\tan" → tab+"an").
    test('repairs JSON-escape-mangled LaTeX from the model before rendering', async () => {
      const doc = {
        instructions: 'Answer all questions carefully.',
        questions: [
          {
            type: 'mcq',
            text: 'If $\tan \theta = \frac{3}{4}$, what is $\text{cosec } \theta$?',
            options: ['$\frac{5}{3}$', '$\frac{5}{4}$', '$\text{sqrt}(2)$', '$\tan 60^\text{o}$'],
            correctOptionIndex: 0,
            correctAnswer: '',
          },
          mockMcqQuestion(2),
          mockMcqQuestion(3),
        ],
      };
      mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
      const res = await generate(teacherAToken, { ...validConfig, questionCount: 3 });
      expect(res.status).toBe(200);
      const { content } = res.body;

      expect(content).toContain('$\\tan \\theta = \\frac{3}{4}$');
      expect(content).toContain('\\operatorname{cosec}');
      expect(content).toContain('A. $\\frac{5}{3}$');
      expect(content).toContain('$\\sqrt{2}$');
      expect(content).toContain('$\\tan 60^{\\circ}$');
      // No JSON-escape control characters survive into the stored document.
      expect(content).not.toMatch(/[\t\f\x08]/);
    });

    test('worksheet format renders the Teacher Answer Key heading', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'mcq' })]);
      const res = await generate(teacherAToken, { ...validConfig, format: 'worksheet', questionCount: 3 });
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('## Teacher Answer Key');
    });

    // Phase 3: Student Name / Roll No. / Date are no longer baked into the
    // generated Markdown as hardcoded lines — that's now a teacher-configured
    // letterhead (Resource.structured.examMeta) rendered client-side by
    // ExamHeader.tsx, for both quiz and worksheet alike, never AI-authored text.
    test('does NOT hardcode Student Name/Date lines into the document (superseded by the client-rendered letterhead)', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'mcq' })]);
      const res = await generate(teacherAToken, { ...validConfig, format: 'worksheet', questionCount: 3 });
      expect(res.status).toBe(200);
      expect(res.body.content).not.toContain('Student Name:');
      expect(res.body.content).not.toContain('Date: __________');
    });

    test('true_false and short_answer question types render correctly', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'true_false' })]);
      let res = await generate(teacherAToken, { ...validConfig, questionType: 'true_false', questionCount: 3 });
      expect(res.status).toBe(200);
      expect(res.body.content).toMatch(/1\. Statement 1\. — \(True \/ False\)/);
      expect(res.body.content).toMatch(/## Answer Key[\s\S]*1\. False/); // i=1 (1-indexed) -> i%2===0 is false in builder for i=1

      mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'short_answer' })]);
      res = await generate(teacherAToken, { ...validConfig, questionType: 'short_answer', questionCount: 3 });
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('1. Explain concept 1.');
      expect(res.body.content).toMatch(/## Answer Key[\s\S]*1\. Model answer 1\./);
    });

    test('accepts the maximum question count (30)', async () => {
      mockGeminiFetch([mockAssessmentJsonResponse({ count: 30, type: 'mcq' })]);
      const res = await generate(teacherAToken, { ...validConfig, questionCount: 30 });
      expect(res.status).toBe(200);
    });

    test('rejects an invalid format', async () => {
      const res = await generate(teacherAToken, { ...validConfig, format: 'essay' });
      expect(res.status).toBe(400);
    });

    test('rejects an invalid difficulty', async () => {
      const res = await generate(teacherAToken, { ...validConfig, difficulty: 'impossible' });
      expect(res.status).toBe(400);
    });

    test('rejects an invalid question type', async () => {
      const res = await generate(teacherAToken, { ...validConfig, questionType: 'crossword' });
      expect(res.status).toBe(400);
    });

    test('rejects a question count below the minimum', async () => {
      const res = await generate(teacherAToken, { ...validConfig, questionCount: 2 });
      expect(res.status).toBe(400);
    });

    test('rejects a question count above the maximum', async () => {
      const res = await generate(teacherAToken, { ...validConfig, questionCount: 31 });
      expect(res.status).toBe(400);
    });

    test('rejects a missing topic', async () => {
      const { topic, ...noTopic } = validConfig;
      void topic;
      const res = await generate(teacherAToken, noTopic);
      expect(res.status).toBe(400);
    });

    test('rejects an unknown field (strict schema)', async () => {
      const res = await generate(teacherAToken, { ...validConfig, userId: fx.teacherB.id });
      expect(res.status).toBe(400);
    });

    test('handles an upstream AI failure gracefully (no crash, mapped error)', async () => {
      // Repeated 500s exhaust retries -> generic upstream failure.
      mockGeminiFetch([{ status: 500, text: 'boom' }]);
      const res = await generate(teacherAToken, validConfig);
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE');
    });

    // --- Malformed / non-compliant AI response handling (Phase 1) ----------
    // Previously (Markdown generation) there was no server-side check at all
    // that the model's output actually matched what was asked for — these
    // cases would have silently reached the teacher's preview looking
    // "generated" even when broken. Now every one of these is rejected with
    // a typed, non-200 error instead.
    describe('malformed / non-compliant AI responses', () => {
      test('rejects a response that is not valid JSON at all', async () => {
        mockGeminiFetch([geminiSuccess('# Quiz: Photosynthesis\n1. Q?\n## Answer Key\n1. A')]);
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects valid JSON that does not match the schema shape at all', async () => {
        mockGeminiFetch([geminiSuccess(JSON.stringify({ foo: 'bar' }))]);
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects an MCQ question with only 3 options', async () => {
        const doc = mockAssessmentDoc({ count: 5, type: 'mcq' });
        doc.questions[0].options = ['Only', 'Three', 'Options'];
        mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects an MCQ question with an out-of-range correctOptionIndex', async () => {
        const doc = mockAssessmentDoc({ count: 5, type: 'mcq' });
        doc.questions[0].correctOptionIndex = 7;
        mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects a true_false question whose correctAnswer is not "True"/"False"', async () => {
        const doc = mockAssessmentDoc({ count: 3, type: 'true_false' });
        doc.questions[0].correctAnswer = 'Maybe';
        mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionType: 'true_false', questionCount: 3 });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects a short_answer question with an empty correctAnswer', async () => {
        const doc = mockAssessmentDoc({ count: 3, type: 'short_answer' });
        doc.questions[0].correctAnswer = '';
        mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionType: 'short_answer', questionCount: 3 });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects a response with fewer questions than requested', async () => {
        mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: 'mcq' })]); // requested 5
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects a response with more questions than requested', async () => {
        mockGeminiFetch([mockAssessmentJsonResponse({ count: 8, type: 'mcq' })]); // requested 5
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('rejects a response whose question types do not match a non-mixed request', async () => {
        mockGeminiFetch([mockAssessmentJsonResponse({ count: 5, type: 'true_false' })]); // requested mcq
        const res = await generate(teacherAToken, validConfig); // questionType: 'mcq'
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });

      test('accepts a mixed-type response when questionType is "mixed"', async () => {
        const doc = {
          instructions: 'Answer everything.',
          questions: [
            mockMcqQuestion(1),
            mockTrueFalseQuestion(2),
            mockShortAnswerQuestion(3),
          ],
        };
        mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionType: 'mixed', questionCount: 3 });
        expect(res.status).toBe(200);
        expect(res.body.content).toContain('1. Question 1?');
        expect(res.body.content).toMatch(/2\. Statement 2\. — \(True \/ False\)/);
        expect(res.body.content).toContain('3. Explain concept 3.');
      });

      test('rejects a response cut off mid-JSON (truncation is not spliced/continued for structured output)', async () => {
        // A response that reports MAX_TOKENS with a truncated JSON body.
        // generateContent() skips its continuation loop when responseSchema
        // is set, so this reaches the route as invalid JSON.
        mockGeminiFetch([
          { status: 200, json: { candidates: [{ content: { parts: [{ text: '{"instructions": "Answer all", "quest' }] }, finishReason: 'MAX_TOKENS' }] } },
        ]);
        const res = await generate(teacherAToken, validConfig);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
      });
    });

    // --- LaTeX safety guard (lib/latexGuard.js) -----------------------------
    // Root cause: normalizeAssessmentMath only ever repairs LaTeX INSIDE an
    // existing $...$/$$...$$ pair — by design (see assessmentSchema.test.js's
    // "does not touch \text{...} outside math delimiters"). Gemini sometimes
    // drops the $ delimiters entirely around a unit-bearing quantity, most
    // often in MCQ "options" — a real Chemistry MCQ response captured live
    // during the investigation came back as
    // options: ["0.25 \\text{ mol}", ...] with NO delimiters at all. This
    // guard is a second pass, run after normalizeAssessmentMath, that
    // auto-repairs that mechanical case and rejects+regenerates anything it
    // can't safely repair — so raw LaTeX can never reach the client
    // regardless of what the model does, without relying on prompt wording.
    describe('LaTeX safety guard (post-generation, treats Gemini output as untrusted)', () => {
      test('auto-repairs bare LaTeX (missing $ delimiters) before rendering, without regenerating', async () => {
        const doc = mockAssessmentDoc({ count: 3, type: 'mcq' });
        // Verbatim shape of the real captured regression: unit-bearing MCQ
        // options with \text{} but no surrounding $...$ at all.
        doc.questions[0].options = ['0.25 \\text{ mol}', '0.5 \\text{ mol}', '1.0 \\text{ mol}', '2.0 \\text{ mol}'];
        const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(doc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionCount: 3 });
        expect(res.status).toBe(200);
        expect(res.body.content).toContain('A. $0.25 \\text{ mol}$');
        // No \text{ survives OUTSIDE a $...$ pair anywhere in the document.
        const outsideMath = res.body.content.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, '');
        expect(outsideMath).not.toMatch(/\\text\{/);
        expect(mock).toHaveBeenCalledTimes(1); // repaired in place, no regeneration needed
      });

      test('rejects unrepairable bare LaTeX and regenerates, succeeding on a later attempt', async () => {
        const badDoc = mockAssessmentDoc({ count: 3, type: 'mcq' });
        // Unbalanced brace — the guard deliberately does not guess at this;
        // it must come back as a failed attempt, not a silently-broken wrap.
        badDoc.questions[0].options = ['30\\text{ km/h', 'Option B', 'Option C', 'Option D'];
        const goodDoc = mockAssessmentDoc({ count: 3, type: 'mcq' });

        const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(badDoc)), geminiSuccess(JSON.stringify(goodDoc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionCount: 3 });
        expect(res.status).toBe(200);
        expect(res.body.content).toContain('Question 1?'); // the good doc's content
        expect(mock).toHaveBeenCalledTimes(2); // first attempt rejected, second accepted
      });

      test('gives up and returns 502 INVALID_AI_RESPONSE after exhausting regeneration attempts', async () => {
        const badDoc = mockAssessmentDoc({ count: 3, type: 'mcq' });
        badDoc.questions[0].options = ['30\\text{ km/h', 'Option B', 'Option C', 'Option D'];
        // mockGeminiFetch repeats the last queued entry for every further
        // call, so every attempt gets the same unrepairable response.
        const { mock } = mockGeminiFetch([geminiSuccess(JSON.stringify(badDoc))]);
        const res = await generate(teacherAToken, { ...validConfig, questionCount: 3 });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('INVALID_AI_RESPONSE');
        // 1 initial attempt + MAX_LATEX_REGEN_ATTEMPTS (2) retries = 3 total
        // calls — never fewer (teacher must never see unsafe content) and
        // never more (bounded cost/latency).
        expect(mock).toHaveBeenCalledTimes(3);
      });
    });

    // Structured Question Model (Generator v2, docs/generator-v2-plan.md).
    describe('Structured Question Model — new question types', () => {
      function mockDescriptiveQuestion(i) {
        return {
          type: 'descriptive', text: `Explain concept ${i}.`, options: [], correctOptionIndex: -1,
          correctAnswer: '', modelAnswer: `A model answer for concept ${i}.`,
        };
      }
      function mockFillBlankQuestion(i) {
        return {
          type: 'fill_blank', text: `Blank ${i}: the answer is ___.`, options: [], correctOptionIndex: -1,
          correctAnswer: `answer${i}`, modelAnswer: '',
        };
      }
      function mockMatchQuestion(i) {
        return {
          type: 'match', text: `Match set ${i}.`, options: [], correctOptionIndex: -1, correctAnswer: '', modelAnswer: '',
          pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }, { left: 'C', right: '3' }],
        };
      }

      test('rejects a new question type with 503 STRUCTURED_QUESTIONS_DISABLED when the flag is off', async () => {
        let saved;
        try {
          saved = process.env.STRUCTURED_QUESTIONS_ENABLED;
          delete process.env.STRUCTURED_QUESTIONS_ENABLED;
          const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);
          const res = await generate(teacherAToken, { ...validConfig, questionType: 'descriptive' });
          expect(res.status).toBe(503);
          expect(res.body.code).toBe('STRUCTURED_QUESTIONS_DISABLED');
          expect(mock).not.toHaveBeenCalled();
        } finally {
          if (saved === undefined) delete process.env.STRUCTURED_QUESTIONS_ENABLED;
          else process.env.STRUCTURED_QUESTIONS_ENABLED = saved;
        }
      });

      test.each(['mcq', 'true_false', 'short_answer', 'mixed'])(
        'the original question type "%s" still works with the flag off',
        async (questionType) => {
          let saved;
          try {
            saved = process.env.STRUCTURED_QUESTIONS_ENABLED;
            delete process.env.STRUCTURED_QUESTIONS_ENABLED;
            mockGeminiFetch([mockAssessmentJsonResponse({ count: 3, type: questionType === 'mixed' ? 'mcq' : questionType })]);
            const res = await generate(teacherAToken, { ...validConfig, questionType, questionCount: 3 });
            expect(res.status).toBe(200);
          } finally {
            if (saved === undefined) delete process.env.STRUCTURED_QUESTIONS_ENABLED;
            else process.env.STRUCTURED_QUESTIONS_ENABLED = saved;
          }
        }
      );

      describe('with the flag on', () => {
        let saved;
        beforeAll(() => { saved = process.env.STRUCTURED_QUESTIONS_ENABLED; process.env.STRUCTURED_QUESTIONS_ENABLED = 'true'; });
        afterAll(() => {
          if (saved === undefined) delete process.env.STRUCTURED_QUESTIONS_ENABLED;
          else process.env.STRUCTURED_QUESTIONS_ENABLED = saved;
        });

        test('accepts "descriptive" and returns a structured field (schemaVersion 2) alongside content', async () => {
          mockGeminiFetch([geminiSuccess(JSON.stringify({
            instructions: 'Answer fully.',
            questions: [mockDescriptiveQuestion(1), mockDescriptiveQuestion(2), mockDescriptiveQuestion(3)],
          }))]);
          const res = await generate(teacherAToken, { ...validConfig, questionType: 'descriptive', questionCount: 3 });
          expect(res.status).toBe(200);
          expect(res.body.content).toContain('Explain concept 1.');
          expect(res.body.content).toContain('_(Write your answer in 2-4 sentences.)_');
          expect(res.body.content).toMatch(/## Answer Key[\s\S]*1\. Suggested answer: A model answer for concept 1\./);

          const structured = JSON.parse(res.body.structured);
          expect(structured.schemaVersion).toBe(2);
          expect(structured.questions).toHaveLength(3);
          expect(structured.questions[0].type).toBe('descriptive');
        });

        test('accepts "fill_blank" and renders the blank + answer key', async () => {
          mockGeminiFetch([geminiSuccess(JSON.stringify({
            instructions: 'Fill in each blank.',
            questions: [mockFillBlankQuestion(1), mockFillBlankQuestion(2), mockFillBlankQuestion(3)],
          }))]);
          const res = await generate(teacherAToken, { ...validConfig, questionType: 'fill_blank', questionCount: 3 });
          expect(res.status).toBe(200);
          expect(res.body.content).toContain('Blank 1: the answer is ___.');
          expect(res.body.content).toMatch(/## Answer Key[\s\S]*1\. answer1/);
        });

        test('accepts "match" and renders a two-column table plus the pairing in the answer key', async () => {
          mockGeminiFetch([geminiSuccess(JSON.stringify({
            instructions: 'Match the columns.',
            questions: [mockMatchQuestion(1), mockMatchQuestion(2), mockMatchQuestion(3)],
          }))]);
          const res = await generate(teacherAToken, { ...validConfig, questionType: 'match', questionCount: 3 });
          expect(res.status).toBe(200);
          expect(res.body.content).toContain('| Column A | Column B |');
          expect(res.body.content).toContain('| A | 1 |');
          expect(res.body.content).toMatch(/## Answer Key[\s\S]*1\. A — 1; B — 2; C — 3/);
        });
      });
    });

    // Structured Question Model (Generator v2) — the server-side
    // content-re-renders-from-structured-questions rule (plan §2c), exercised
    // through the same public create/update endpoints 'create'/'update'
    // describe blocks above already cover for the legacy (no schemaVersion)
    // path.
    describe('Structured Question Model — save/edit re-render rule', () => {
      function structuredPayload(overrides = {}) {
        return JSON.stringify({
          schemaVersion: 2,
          format: 'quiz',
          topic: 'Fractions',
          grade: 'Class 5',
          subject: 'Maths',
          difficulty: 'medium',
          instructions: 'Answer all questions.',
          questions: [
            { type: 'mcq', text: 'What is 1/2 + 1/2?', options: ['1', '2', '0', '1/4'], correctOptionIndex: 0, correctAnswer: '' },
            { type: 'true_false', text: '1/2 is bigger than 1/4.', options: [], correctOptionIndex: -1, correctAnswer: 'True' },
            { type: 'fill_blank', text: 'A fraction with a numerator of 0 equals ___.', options: [], correctOptionIndex: -1, correctAnswer: '0' },
          ],
          ...overrides,
        });
      }

      test('POST /resources with structured.questions renders content server-side, ignoring any client-sent content', async () => {
        const res = await request(app).post('/api/resources').set('Authorization', `Bearer ${teacherAToken}`).send({
          type: 'assessment',
          title: 'Fractions quiz',
          content: 'this string must be ignored',
          structured: structuredPayload(),
        });
        expect(res.status).toBe(201);
        expect(res.body.resource.content).not.toContain('this string must be ignored');
        expect(res.body.resource.content).toContain('What is 1/2 + 1/2?');
        expect(res.body.resource.content).toContain('A fraction with a numerator of 0 equals ___.');
        expect(res.body.resource.content).toContain('## Answer Key');
      });

      test('POST /resources rejects invalid structured.questions with 400', async () => {
        const res = await request(app).post('/api/resources').set('Authorization', `Bearer ${teacherAToken}`).send({
          type: 'assessment',
          title: 'Broken quiz',
          structured: structuredPayload({ questions: [] }), // fails min(1)
        });
        expect(res.status).toBe(400);
        const rows = await prisma.resource.findMany({ where: { title: 'Broken quiz' } });
        expect(rows).toHaveLength(0);
      });

      test('a legacy structured payload (no schemaVersion) leaves content exactly as sent', async () => {
        const res = await request(app).post('/api/resources').set('Authorization', `Bearer ${teacherAToken}`).send({
          type: 'lesson_plan',
          title: 'Legacy plan',
          content: '## Objectives\nTeach fractions.',
          structured: JSON.stringify({ duration: '40 min' }),
        });
        expect(res.status).toBe(201);
        expect(res.body.resource.content).toBe('## Objectives\nTeach fractions.');
      });

      test('PATCH /resources/:id with edited structured.questions re-renders content, dropping a deleted question', async () => {
        const created = await request(app).post('/api/resources').set('Authorization', `Bearer ${teacherAToken}`).send({
          type: 'assessment',
          title: 'Fractions quiz',
          structured: structuredPayload(),
        });
        expect(created.status).toBe(201);

        // Simulate the teacher deleting the fill_blank question in the new
        // question-list editor — client sends the array with 2 items instead of 3.
        const edited = JSON.parse(structuredPayload());
        edited.questions = edited.questions.slice(0, 2);

        const patched = await request(app)
          .patch(`/api/resources/${created.body.resource.id}`)
          .set('Authorization', `Bearer ${teacherAToken}`)
          .send({ structured: JSON.stringify(edited), content: 'ignored on this path too' });
        expect(patched.status).toBe(200);
        expect(patched.body.resource.content).not.toContain('ignored on this path too');
        expect(patched.body.resource.content).not.toContain('numerator of 0');
        expect(patched.body.resource.content).toContain('What is 1/2 + 1/2?');
      });

      test('PATCH /resources/:id with a legacy resource (plain content edit) is unaffected', async () => {
        const created = await request(app).post('/api/resources').set('Authorization', `Bearer ${teacherAToken}`).send({
          type: 'lesson_plan',
          title: 'Legacy plan',
          content: 'original body',
        });
        const patched = await request(app)
          .patch(`/api/resources/${created.body.resource.id}`)
          .set('Authorization', `Bearer ${teacherAToken}`)
          .send({ content: 'edited body' });
        expect(patched.status).toBe(200);
        expect(patched.body.resource.content).toBe('edited body');
      });
    });
  });
});
