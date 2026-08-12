// PYQ chapter/topic classification — Phase 5. Route-level tests for
// POST /api/admin/pyq/papers/:id/classify, mirroring
// test/adminPyq.extract.test.js's fixture/mockGeminiFetch style exactly.
// Covers: authorization, the closed-taxonomy "ask nicely, then verify"
// guarantee (an invented chapter/topic name is dropped, never trusted),
// malformed AI output, idempotent reclassification (a page with nothing left
// to classify is a clean 409, never a silent re-touch), and that a rejected
// question is never targeted.
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
let chapterA; // has topics
let chapterB; // has topics
let seq = 0;

async function makeTaxonomy(prefix) {
  const b = await prisma.board.create({ data: { name: `${prefix} Board`, code: `${prefix}BRD`.toUpperCase().slice(0, 20) } });
  const s = await prisma.subject.create({ data: { boardId: b.id, classLevel: '10', name: 'Mathematics' } });
  const cA = await prisma.chapter.create({ data: { subjectId: s.id, name: 'Real Numbers', sequence: 1 } });
  const cB = await prisma.chapter.create({ data: { subjectId: s.id, name: 'Polynomials', sequence: 2 } });
  await prisma.topic.create({ data: { chapterId: cA.id, name: 'Fundamental Theorem of Arithmetic' } });
  await prisma.topic.create({ data: { chapterId: cA.id, name: 'Irrationality Proofs' } });
  await prisma.topic.create({ data: { chapterId: cB.id, name: 'Zeroes and Coefficients of a Quadratic Polynomial' } });
  return { board: b, subject: s, chapterA: cA, chapterB: cB };
}

function validFields(overrides = {}) {
  seq += 1;
  return {
    boardId: board.id, subjectId: subject.id, classLevel: '10', year: '2020', examType: 'annual',
    setLabel: `T${seq}`, language: 'en', ...overrides,
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
    questionNumber: '1', requiresGroupSelection: false, language: 'en', type: 'short_answer',
    text: 'Prove that root 2 is irrational.', options: [], marks: 2, correctAnswer: '',
    hasOfficialAnswer: false, hasDiagram: false, hasTable: false, confidence: 0.9, ...overrides,
  };
}

/** Uploads + extracts page 1 with the given questions via mocked Gemini extraction. Returns { paper, questions }. */
async function uploadAndExtract(token, tag, ...questions) {
  const paper = await uploadPaper(token, onePagePdf(`pyqclassify-${tag}`));
  mockGeminiFetch([geminiSuccess(JSON.stringify({ questions: questions.length ? questions : [q()] }))]);
  const res = await request(app).post(`/api/admin/pyq/papers/${paper.id}/extract`).set('Authorization', `Bearer ${token}`).send({});
  expect(res.status).toBe(202);
  vi.unstubAllGlobals();
  const rows = await prisma.question.findMany({ where: { examPaperId: paper.id }, orderBy: { questionNumber: 'asc' } });
  return { paper, questions: rows };
}

function classify(token, paperId, body) {
  return request(app).post(`/api/admin/pyq/papers/${paperId}/classify`).set('Authorization', `Bearer ${token}`).send(body || {});
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqclassify');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  const created = await makeTaxonomy('pyqclassify');
  board = created.board;
  subject = created.subject;
  chapterA = created.chapterA;
  chapterB = created.chapterB;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/pyq/papers/:id/classify — authentication & RBAC', () => {
  test('requires a token', async () => {
    const { paper } = await uploadAndExtract(tokens.super_admin, 'auth');
    const res = await request(app).post(`/api/admin/pyq/papers/${paper.id}/classify`).send({});
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { paper } = await uploadAndExtract(tokens.super_admin, `rbac-${role}`);
    const res = await classify(tokens[role], paper.id, {});
    expect(res.status).toBe(403);
  });

  test('404s for an unknown paper id', async () => {
    const res = await classify(tokens.super_admin, 'does-not-exist', {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/pyq/papers/:id/classify — NO_TAXONOMY', () => {
  test('409s when the subject has no seeded chapters', async () => {
    const b = await prisma.board.create({ data: { name: 'No Taxonomy Board', code: 'NOTAXBRD' } });
    const s = await prisma.subject.create({ data: { boardId: b.id, classLevel: '10', name: 'Mathematics' } });
    const savedBoard = board, savedSubject = subject;
    board = b; subject = s;
    const { paper } = await uploadAndExtract(tokens.super_admin, 'notax');
    board = savedBoard; subject = savedSubject;

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_TAXONOMY');
  });
});

describe('POST /api/admin/pyq/papers/:id/classify — valid classification', () => {
  test('writes chapterId and AI-sourced QuestionTopic rows for every question Gemini matched to a real chapter/topic', async () => {
    const { paper, questions } = await uploadAndExtract(
      tokens.super_admin, 'happy',
      q({ questionNumber: '1', text: 'Prove that root 2 is irrational.' }),
      q({ questionNumber: '2', text: 'Find the zeroes of x^2 - 5x + 6.' })
    );
    const [q1, q2] = questions;

    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [
        { questionId: q1.id, chapterName: 'Real Numbers', topicNames: ['Irrationality Proofs'] },
        { questionId: q2.id, chapterName: 'Polynomials', topicNames: ['Zeroes and Coefficients of a Quadratic Polynomial'] },
      ],
    }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.classifiedCount).toBe(2);
    expect(res.body.unclassifiedCount).toBe(0);

    const updated1 = await prisma.question.findUnique({ where: { id: q1.id }, include: { topics: { include: { topic: true } } } });
    const updated2 = await prisma.question.findUnique({ where: { id: q2.id }, include: { topics: { include: { topic: true } } } });
    expect(updated1.chapterId).toBe(chapterA.id);
    expect(updated1.topics).toHaveLength(1);
    expect(updated1.topics[0].topic.name).toBe('Irrationality Proofs');
    expect(updated1.topics[0].source).toBe('ai');
    expect(updated2.chapterId).toBe(chapterB.id);
  });

  test('ASK NICELY, THEN VERIFY: an invented chapter name is dropped, never force-matched — the question stays unclassified', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'invented-chapter');
    const [question] = questions;

    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [{ questionId: question.id, chapterName: 'A Chapter That Was Never Seeded', topicNames: [] }],
    }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.classifiedCount).toBe(0);
    expect(res.body.unclassifiedCount).toBe(1);

    const updated = await prisma.question.findUnique({ where: { id: question.id } });
    expect(updated.chapterId).toBeNull();
  });

  test('ASK NICELY, THEN VERIFY: a topic name that does not belong to the chosen chapter is dropped, but the chapter itself still applies', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'cross-chapter-topic');
    const [question] = questions;

    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [{
        questionId: question.id,
        chapterName: 'Real Numbers',
        // This topic genuinely exists, but under Polynomials, not Real Numbers.
        topicNames: ['Zeroes and Coefficients of a Quadratic Polynomial'],
      }],
    }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.classifiedCount).toBe(1);

    const updated = await prisma.question.findUnique({ where: { id: question.id }, include: { topics: true } });
    expect(updated.chapterId).toBe(chapterA.id);
    expect(updated.topics).toHaveLength(0); // the cross-chapter topic never got attached
  });

  test('a questionId not in the requested batch is ignored, never trusted', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'unknown-id');
    const [question] = questions;

    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [
        { questionId: 'not-a-real-question-id', chapterName: 'Real Numbers', topicNames: [] },
        { questionId: question.id, chapterName: 'Real Numbers', topicNames: [] },
      ],
    }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.classifiedCount).toBe(1); // only the real id was applied
  });
});

describe('POST /api/admin/pyq/papers/:id/classify — malformed AI output', () => {
  test('502s on non-JSON Gemini output and persists nothing', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'malformed');
    mockGeminiFetch([geminiSuccess('not valid json at all')]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');

    const unchanged = await prisma.question.findUnique({ where: { id: questions[0].id } });
    expect(unchanged.chapterId).toBeNull();
  });

  test('502s when the response fails schema validation (e.g. chapterName missing)', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'schema-fail');
    mockGeminiFetch([geminiSuccess(JSON.stringify({ classifications: [{ questionId: questions[0].id, topicNames: [] }] }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');
  });
});

describe('POST /api/admin/pyq/papers/:id/classify — idempotency & rejected-question exclusion', () => {
  test('a page with nothing left to classify is a clean 409, never a silent re-touch of an already-classified question', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'idempotent');
    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [{ questionId: questions[0].id, chapterName: 'Real Numbers', topicNames: [] }],
    }))]);
    const first = await classify(tokens.super_admin, paper.id, {});
    expect(first.status).toBe(202);
    expect(first.body.classifiedCount).toBe(1);

    // Re-running against the same page: the question is no longer
    // reviewStatus 'extracted' + chapterId null, so it's structurally
    // excluded from the target set — no second Gemini call is even needed
    // to prove this; the route must 409 before ever calling Gemini again.
    const second = await classify(tokens.super_admin, paper.id, { page: 1 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('NOTHING_TO_CLASSIFY');
  });

  test('a rejected question is never targeted by classification', async () => {
    const { paper, questions } = await uploadAndExtract(
      tokens.super_admin, 'rejected-excluded',
      q({ questionNumber: '1', text: 'Question that gets rejected.' }),
      q({ questionNumber: '2', text: 'Question that stays extracted.' })
    );
    const [q1, q2] = questions;

    const rejectRes = await request(app)
      .post(`/api/admin/pyq/questions/${q1.id}/reject`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send();
    expect(rejectRes.status).toBe(200);

    mockGeminiFetch([geminiSuccess(JSON.stringify({
      classifications: [{ questionId: q2.id, chapterName: 'Real Numbers', topicNames: [] }],
    }))]);

    const res = await classify(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.classifiedCount).toBe(1); // only q2 — q1 was structurally excluded

    const rejected = await prisma.question.findUnique({ where: { id: q1.id } });
    expect(rejected.chapterId).toBeNull();
    expect(rejected.reviewStatus).toBe('rejected');
  });
});
