// PYQ admin review — Phase 4. Route-level tests for
// GET /api/admin/pyq/boards, GET /api/admin/pyq/papers/:id/questions,
// PATCH /api/admin/pyq/questions/:id, POST .../approve, POST .../reject.
// Mirrors test/adminPyq.extract.test.js's fixture style — a real paper is
// uploaded then extracted (via mocked Gemini) to produce real Question rows
// to review, exactly the pipeline Phase 4 sits on top of.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

function onePagePdf(tag) {
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n% ${tag}\n`, 'latin1');
}

let fixtures;
let tokens;
let board;
let subject;
let chapterA; // Phase 5 fixture — has topics
let chapterB; // Phase 5 fixture — a different chapter, own topics
let topicA1;
let topicB1;
let seq = 0;

async function makeBoardAndSubject(prefix) {
  const b = await prisma.board.create({ data: { name: `${prefix} Board`, code: `${prefix}BRD`.toUpperCase().slice(0, 20) } });
  const s = await prisma.subject.create({ data: { boardId: b.id, classLevel: '10', name: 'Mathematics' } });
  return { board: b, subject: s };
}

function validFields(overrides = {}) {
  seq += 1;
  return {
    boardId: board.id,
    subjectId: subject.id,
    classLevel: '10',
    year: '2020',
    examType: 'annual',
    setLabel: `T${seq}`,
    language: 'en',
    ...overrides,
  };
}

async function uploadPaper(token, buffer, fieldOverrides = {}) {
  let req = request(app).post('/api/admin/pyq/papers').set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(validFields(fieldOverrides))) req = req.field(key, value);
  const res = await req.attach('file', buffer, 'paper.pdf');
  expect(res.status).toBe(201);
  return res.body.paper;
}

function q(overrides = {}) {
  return {
    questionNumber: '1',
    requiresGroupSelection: false,
    language: 'en',
    type: 'short_answer',
    text: 'Solve for x: 2x + 3 = 7.',
    options: [],
    marks: 2,
    correctAnswer: '',
    hasOfficialAnswer: false,
    hasDiagram: false,
    hasTable: false,
    confidence: 0.92,
    ...overrides,
  };
}

/** Uploads a paper and extracts page 1 with the given questions, returning { paper, questions }. */
async function uploadAndExtract(token, tag, ...questions) {
  // Namespaced with this file's own prefix — PDF bytes (and therefore their
  // checksum) must be globally unique across the whole shared test DB, not
  // just within this file, or a tag reused by another *.test.js file
  // collides on SourceDocument.checksum's unique constraint (409) when both
  // files run concurrently. See adminPyq.extract.test.js's own uniquePdfBytes
  // comment for the same reasoning.
  const paper = await uploadPaper(token, onePagePdf(`pyqrev-${tag}`));
  mockGeminiFetch([geminiSuccess(JSON.stringify({ questions: questions.length ? questions : [q()] }))]);
  const res = await request(app)
    .post(`/api/admin/pyq/papers/${paper.id}/extract`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(202);
  vi.unstubAllGlobals();
  const rows = await prisma.question.findMany({ where: { examPaperId: paper.id }, orderBy: { questionNumber: 'asc' } });
  return { paper, questions: rows };
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqrev');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  const created = await makeBoardAndSubject('pyqrev');
  board = created.board;
  subject = created.subject;
  chapterA = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Real Numbers', sequence: 1 } });
  chapterB = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Polynomials', sequence: 2 } });
  topicA1 = await prisma.topic.create({ data: { chapterId: chapterA.id, name: 'Irrationality Proofs' } });
  topicB1 = await prisma.topic.create({ data: { chapterId: chapterB.id, name: 'Zeroes of a Polynomial' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/admin/pyq/boards', () => {
  test('requires a token', async () => {
    const res = await request(app).get('/api/admin/pyq/boards');
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await request(app).get('/api/admin/pyq/boards').set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });

  test('super_admin lists boards with nested subjects, and (Phase 5) nested chapters/topics', async () => {
    const res = await request(app).get('/api/admin/pyq/boards').set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.boards)).toBe(true);
    const b = res.body.boards.find((x) => x.id === board.id);
    expect(b).toBeTruthy();
    const s = b.subjects.find((x) => x.id === subject.id);
    expect(s).toBeTruthy();
    const c = s.chapters.find((x) => x.id === chapterA.id);
    expect(c).toBeTruthy();
    expect(c.topics).toEqual([{ id: topicA1.id, name: topicA1.name }]);
  });
});

describe('GET /api/admin/pyq/papers/:id/questions', () => {
  test('requires a token', async () => {
    const { paper } = await uploadAndExtract(tokens.super_admin, 'auth');
    const res = await request(app).get(`/api/admin/pyq/papers/${paper.id}/questions`);
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { paper } = await uploadAndExtract(tokens.super_admin, `rbac-${role}`);
    const res = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}/questions`)
      .set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });

  test('404s for an unknown paper id', async () => {
    const res = await request(app)
      .get('/api/admin/pyq/papers/does-not-exist/questions')
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(404);
  });

  test('returns every extracted question, including rawExtraction, in page/number order', async () => {
    const { paper } = await uploadAndExtract(
      tokens.super_admin,
      'list',
      q({ questionNumber: '1', text: 'First question' }),
      q({ questionNumber: '2', text: 'Second question' })
    );
    const res = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}/questions`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.questions[0].text).toBe('First question');
    expect(res.body.questions[0].reviewStatus).toBe('extracted');
    expect(res.body.questions[0].rawExtraction).toBeTruthy();
    expect(res.body.questions[0].rawExtraction.text).toBe('First question');
  });

  test('filters by reviewStatus', async () => {
    const { paper, questions } = await uploadAndExtract(
      tokens.super_admin,
      'filter',
      q({ questionNumber: '1' }),
      q({ questionNumber: '2' })
    );
    await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);

    const approved = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}/questions`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .query({ reviewStatus: 'approved' });
    expect(approved.body.questions).toHaveLength(1);
    expect(approved.body.questions[0].id).toBe(questions[0].id);

    const extracted = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}/questions`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .query({ reviewStatus: 'extracted' });
    expect(extracted.body.questions).toHaveLength(1);
    expect(extracted.body.questions[0].id).toBe(questions[1].id);
  });
});

describe('PATCH /api/admin/pyq/questions/:id', () => {
  test('requires a token', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-auth');
    const res = await request(app).patch(`/api/admin/pyq/questions/${questions[0].id}`).send({ marks: 5 });
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { questions } = await uploadAndExtract(tokens.super_admin, `patch-rbac-${role}`);
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .send({ marks: 5 });
    expect(res.status).toBe(403);
  });

  test('404s for an unknown question id', async () => {
    const res = await request(app)
      .patch('/api/admin/pyq/questions/does-not-exist')
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ marks: 5 });
    expect(res.status).toBe(404);
  });

  test('rejects an empty patch body', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-empty');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('edits allowed fields and moves reviewStatus extracted -> reviewed', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-edit', q({ text: 'Original text' }));
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ text: 'Corrected text', marks: 4, difficulty: 'medium', hasDiagram: true });

    expect(res.status).toBe(200);
    expect(res.body.question.text).toBe('Corrected text');
    expect(res.body.question.marks).toBe(4);
    expect(res.body.question.difficulty).toBe('medium');
    expect(res.body.question.hasDiagram).toBe(true);
    expect(res.body.question.reviewStatus).toBe('reviewed');
    expect(res.body.question.reviewedById).toBe(fixtures.superAdmin.id);
    expect(res.body.question.reviewedAt).toBeTruthy();

    const events = await prisma.event.findMany({ where: { type: 'pyq_question_reviewed', userId: fixtures.superAdmin.id } });
    expect(events.some((e) => JSON.parse(e.metadata).questionId === questions[0].id)).toBe(true);
    // Metadata carries field NAMES only, never the edited text/values.
    const ev = events.find((e) => JSON.parse(e.metadata).questionId === questions[0].id);
    expect(JSON.stringify(JSON.parse(ev.metadata))).not.toContain('Corrected text');
  });

  test('never accepts provenance/immutable fields — rejected outright by .strict()', async () => {
    const { questions, paper } = await uploadAndExtract(tokens.super_admin, 'patch-immutable');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ pageNumber: 99, examPaperId: 'other', rawExtraction: '{}' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');

    const stillSame = await prisma.question.findUnique({ where: { id: questions[0].id } });
    expect(stillSame.pageNumber).toBe(1);
    expect(stillSame.examPaperId).toBe(paper.id);
  });

  test('correctAnswer edit derives hasOfficialAnswer instead of accepting it directly', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-answer', q({ hasOfficialAnswer: false, correctAnswer: '' }));

    const setAnswer = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ correctAnswer: 'x = 2' });
    expect(setAnswer.status).toBe(200);
    expect(setAnswer.body.question.correctAnswer).toBe('x = 2');
    expect(setAnswer.body.question.hasOfficialAnswer).toBe(true);

    const clearAnswer = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ correctAnswer: '' });
    expect(clearAnswer.status).toBe(200);
    expect(clearAnswer.body.question.hasOfficialAnswer).toBe(false);

    // hasOfficialAnswer itself is not a field the client can set directly.
    const direct = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ hasOfficialAnswer: true });
    expect(direct.status).toBe(400);
    expect(direct.body.code).toBe('INVALID_FIELDS');
  });

  test('mcq requires exactly 4 options, checked against the EFFECTIVE type/options', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-mcq', q({ type: 'short_answer' }));

    const tooFew = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ type: 'mcq', options: ['A', 'B'] });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.code).toBe('INVALID_FIELDS');

    const ok = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ type: 'mcq', options: ['A', 'B', 'C', 'D'] });
    expect(ok.status).toBe(200);
    expect(ok.body.question.options).toEqual(['A', 'B', 'C', 'D']);

    // Switching AWAY from mcq clears the now-meaningless options.
    const switchAway = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ type: 'short_answer' });
    expect(switchAway.status).toBe(200);
    expect(switchAway.body.question.options).toBeNull();
  });

  test('blocked once already approved or rejected (409 ALREADY_REVIEWED)', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-terminal');
    await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);

    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ marks: 9 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REVIEWED');
  });
});

describe('PATCH /api/admin/pyq/questions/:id — chapterId/topicIds (Phase 5)', () => {
  test('accepts a valid chapterId + topicIds belonging to that chapter', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-chapter-valid');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ chapterId: chapterA.id, topicIds: [topicA1.id] });
    expect(res.status).toBe(200);
    expect(res.body.question.chapterId).toBe(chapterA.id);
    expect(res.body.question.topics).toEqual([{ id: topicA1.id, name: topicA1.name, source: 'human' }]);
  });

  test('rejects a chapterId belonging to a different subject', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-chapter-wrong-subject');
    seq += 1;
    const otherBoard = await prisma.board.create({ data: { name: 'Other Board', code: `OTHERBRD${seq}` } });
    const otherSubject = await prisma.subject.create({ data: { boardId: otherBoard.id, classLevel: '10', name: 'Science' } });
    const otherChapter = await prisma.chapter.create({ data: { subjectId: otherSubject.id, name: 'Light', sequence: 1 } });

    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ chapterId: otherChapter.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('rejects an unknown chapterId outright', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-chapter-unknown');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ chapterId: 'does-not-exist' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('rejects a topicId that does not belong to the chosen chapter', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-topic-wrong-chapter');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      // topicB1 belongs to chapterB, not chapterA.
      .send({ chapterId: chapterA.id, topicIds: [topicB1.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');

    const unchanged = await prisma.question.findUnique({ where: { id: questions[0].id }, include: { topics: true } });
    expect(unchanged.chapterId).toBeNull();
    expect(unchanged.topics).toHaveLength(0);
  });

  test('rejects topicIds with no chapterId (neither in this PATCH nor already on the question)', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-topic-no-chapter');
    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ topicIds: [topicA1.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('clearing chapterId (null) with no explicit topicIds also clears every topic', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-chapter-clear');
    const set = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ chapterId: chapterA.id, topicIds: [topicA1.id] });
    expect(set.status).toBe(200);

    const cleared = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ chapterId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.question.chapterId).toBeNull();
    expect(cleared.body.question.topics).toEqual([]);
  });

  test('a topicIds PATCH REPLACES the full set — a reviewer removing one AI-proposed topic is a single PATCH', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-topic-replace');
    // Simulate an AI-proposed topic set (as classifyAndPersistPage would write it).
    await prisma.question.update({ where: { id: questions[0].id }, data: { chapterId: chapterA.id } });
    await prisma.questionTopic.create({ data: { questionId: questions[0].id, topicId: topicA1.id, source: 'ai' } });

    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ topicIds: [] }); // reviewer decides no topic actually applies
    expect(res.status).toBe(200);
    expect(res.body.question.topics).toEqual([]);

    const remaining = await prisma.questionTopic.findMany({ where: { questionId: questions[0].id } });
    expect(remaining).toHaveLength(0);
  });

  test('a human PATCH always writes source: human, even overwriting an existing AI-proposed topic', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'patch-topic-human-wins');
    await prisma.question.update({ where: { id: questions[0].id }, data: { chapterId: chapterA.id } });
    await prisma.questionTopic.create({ data: { questionId: questions[0].id, topicId: topicA1.id, source: 'ai' } });

    const res = await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ topicIds: [topicA1.id] }); // same topic, but now a human confirmation
    expect(res.status).toBe(200);
    expect(res.body.question.topics).toEqual([{ id: topicA1.id, name: topicA1.name, source: 'human' }]);
  });
});

describe('POST /api/admin/pyq/questions/:id/approve', () => {
  test('requires a token', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'approve-auth');
    const res = await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/approve`);
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { questions } = await uploadAndExtract(tokens.super_admin, `approve-rbac-${role}`);
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });

  test('404s for an unknown question id', async () => {
    const res = await request(app)
      .post('/api/admin/pyq/questions/does-not-exist/approve')
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(404);
  });

  test('approves a freshly-extracted question directly (no PATCH required first)', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'approve-direct');
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe('approved');

    const row = await prisma.question.findUnique({ where: { id: questions[0].id } });
    expect(row.reviewStatus).toBe('approved');
    expect(row.reviewedById).toBe(fixtures.superAdmin.id);

    const events = await prisma.event.findMany({ where: { type: 'pyq_question_approved' } });
    expect(events.some((e) => JSON.parse(e.metadata).questionId === questions[0].id)).toBe(true);
  });

  test('409s on a second approve', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'approve-twice');
    await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/approve`).set('Authorization', `Bearer ${tokens.super_admin}`);
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REVIEWED');
  });

  test('409s approving an already-rejected question', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'approve-after-reject');
    await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/reject`).set('Authorization', `Bearer ${tokens.super_admin}`);
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/approve`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/pyq/questions/:id/reject', () => {
  test('requires a token', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'reject-auth');
    const res = await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/reject`);
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { questions } = await uploadAndExtract(tokens.super_admin, `reject-rbac-${role}`);
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/reject`)
      .set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });

  test('404s for an unknown question id', async () => {
    const res = await request(app)
      .post('/api/admin/pyq/questions/does-not-exist/reject')
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(404);
  });

  test('rejects a freshly-extracted question directly', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'reject-direct');
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/reject`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe('rejected');
  });

  test('is reversible: reject succeeds even on an already-approved question, correcting it', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'reject-reverses-approve');
    await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/approve`).set('Authorization', `Bearer ${tokens.super_admin}`);

    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/reject`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe('rejected');

    const row = await prisma.question.findUnique({ where: { id: questions[0].id } });
    expect(row.reviewStatus).toBe('rejected');
  });

  test('is idempotent-safe on an already-rejected question (no error)', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'reject-twice');
    await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/reject`).set('Authorization', `Bearer ${tokens.super_admin}`);
    const res = await request(app)
      .post(`/api/admin/pyq/questions/${questions[0].id}/reject`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe('rejected');
  });
});

describe('Phase 4 review actions — no sensitive content leakage in logs', () => {
  test('question text is never logged by PATCH/approve/reject', async () => {
    const secretText = 'UNIQUE_REVIEW_SECRET_MARKER_554433';
    const { questions } = await uploadAndExtract(tokens.super_admin, 'log-safety', q({ text: secretText }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(app)
        .patch(`/api/admin/pyq/questions/${questions[0].id}`)
        .set('Authorization', `Bearer ${tokens.super_admin}`)
        .send({ text: `${secretText}_edited` });
      await request(app).post(`/api/admin/pyq/questions/${questions[0].id}/approve`).set('Authorization', `Bearer ${tokens.super_admin}`);

      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
      expect(JSON.stringify(allCalls)).not.toContain(secretText);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
