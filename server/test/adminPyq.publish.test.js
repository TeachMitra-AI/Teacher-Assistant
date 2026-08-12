// PYQ publish gate — Phase 7 (docs/pyq-implementation-plan.md §7 status
// table, §8 stage 7, §14). Route-level tests for
// POST /api/admin/pyq/papers/:id/publish. Mirrors adminPyq.review.test.js's
// own fixture style — a real paper is uploaded then extracted (via mocked
// Gemini) to produce real Question rows to review/approve/reject, exactly
// the pipeline Phase 7 sits on top of.
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
let seq = 0;

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
  // Namespaced with this file's own prefix — see adminPyq.review.test.js's
  // own comment: PDF bytes (and therefore their checksum) must be globally
  // unique across the whole shared test DB.
  const paper = await uploadPaper(token, onePagePdf(`pyqpub-${tag}`));
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

async function publish(token, paperId) {
  return request(app).post(`/api/admin/pyq/papers/${paperId}/publish`).set('Authorization', `Bearer ${token}`);
}

async function approve(token, questionId) {
  const res = await request(app).post(`/api/admin/pyq/questions/${questionId}/approve`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
}

async function reject(token, questionId) {
  const res = await request(app).post(`/api/admin/pyq/questions/${questionId}/reject`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqpub');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  board = await prisma.board.create({ data: { name: 'PyqPub Board', code: 'PYQPUBBRD' } });
  subject = await prisma.subject.create({ data: { boardId: board.id, classLevel: '10', name: 'Mathematics' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/pyq/papers/:id/publish — auth/RBAC', () => {
  test('requires a token', async () => {
    const { paper } = await uploadAndExtract(tokens.super_admin, 'auth');
    const res = await request(app).post(`/api/admin/pyq/papers/${paper.id}/publish`);
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { paper } = await uploadAndExtract(tokens.super_admin, `rbac-${role}`);
    const res = await publish(tokens[role], paper.id);
    expect(res.status).toBe(403);
  });

  test('404s for an unknown paper id', async () => {
    const res = await publish(tokens.super_admin, 'does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/pyq/papers/:id/publish — readiness gate', () => {
  test('blocked (409 NOT_READY) when the paper has no extracted questions yet', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('pyqpub-empty'));
    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_READY');

    const row = await prisma.examPaper.findUnique({ where: { id: paper.id } });
    expect(row.status).not.toBe('published');
  });

  test('blocked (409 NOT_READY) while any question is non-terminal (extracted/reviewed), names the count', async () => {
    const { paper, questions } = await uploadAndExtract(
      tokens.super_admin,
      'partial',
      q({ questionNumber: '1' }),
      q({ questionNumber: '2' }),
      q({ questionNumber: '3' })
    );
    await approve(tokens.super_admin, questions[0].id);
    // questions[1] and [2] stay at 'extracted' (non-terminal).

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_READY');
    expect(res.body.error).toContain('2');

    const row = await prisma.examPaper.findUnique({ where: { id: paper.id } });
    expect(row.status).not.toBe('published');
  });

  test('blocked while a question is merely "reviewed" (edited but not approved/rejected)', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'reviewed-only');
    await request(app)
      .patch(`/api/admin/pyq/questions/${questions[0].id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .send({ marks: 3 });

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_READY');
  });

  test('archived papers cannot be published', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'archived');
    await approve(tokens.super_admin, questions[0].id);
    await prisma.examPaper.update({ where: { id: paper.id }, data: { status: 'archived' } });

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_READY');

    const row = await prisma.examPaper.findUnique({ where: { id: paper.id } });
    expect(row.status).toBe('archived');
  });
});

describe('POST /api/admin/pyq/papers/:id/publish — success paths', () => {
  test('publishes once every question is approved', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'all-approved', q({ questionNumber: '1' }), q({ questionNumber: '2' }));
    await approve(tokens.super_admin, questions[0].id);
    await approve(tokens.super_admin, questions[1].id);

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(paper.id);
    expect(res.body.status).toBe('published');

    const row = await prisma.examPaper.findUnique({ where: { id: paper.id } });
    expect(row.status).toBe('published');
  });

  test('a paper whose questions are ALL rejected still publishes — rejected is a valid terminal state', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'all-rejected');
    await reject(tokens.super_admin, questions[0].id);

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
  });

  test('a mix of approved and rejected questions publishes fine', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'mixed', q({ questionNumber: '1' }), q({ questionNumber: '2' }));
    await approve(tokens.super_admin, questions[0].id);
    await reject(tokens.super_admin, questions[1].id);

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
  });

  test('does NOT require chapter/topic classification or clustering to have run', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'no-classification');
    const beforeApprove = await prisma.question.findUnique({ where: { id: questions[0].id } });
    expect(beforeApprove.chapterId).toBeNull(); // never classified

    await approve(tokens.super_admin, questions[0].id);
    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');

    const clusterCount = await prisma.questionClusterMember.count({ where: { questionId: questions[0].id } });
    expect(clusterCount).toBe(0); // never clustered — publish did not require it
  });

  test('publishing writes a pyq_paper_published audit Event with paper-id-only metadata (no question content)', async () => {
    const secretText = 'UNIQUE_PUBLISH_SECRET_MARKER_998877';
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'audit', q({ text: secretText }));
    await approve(tokens.super_admin, questions[0].id);

    const res = await publish(tokens.super_admin, paper.id);
    expect(res.status).toBe(200);

    const events = await prisma.event.findMany({ where: { type: 'pyq_paper_published' } });
    const ev = events.find((e) => JSON.parse(e.metadata).examPaperId === paper.id);
    expect(ev).toBeTruthy();
    expect(ev.userId).toBe(fixtures.superAdmin.id);
    expect(JSON.stringify(JSON.parse(ev.metadata))).not.toContain(secretText);
  });
});

describe('POST /api/admin/pyq/papers/:id/publish — idempotency', () => {
  test('repeating publish on an already-published paper succeeds again (no error) and does not duplicate the audit Event', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'idempotent');
    await approve(tokens.super_admin, questions[0].id);

    const first = await publish(tokens.super_admin, paper.id);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('published');

    const second = await publish(tokens.super_admin, paper.id);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('published');

    const third = await publish(tokens.super_admin, paper.id);
    expect(third.status).toBe(200);

    const events = await prisma.event.findMany({
      where: { type: 'pyq_paper_published' },
    });
    const forThisPaper = events.filter((e) => JSON.parse(e.metadata).examPaperId === paper.id);
    expect(forThisPaper).toHaveLength(1);

    const row = await prisma.examPaper.findUnique({ where: { id: paper.id } });
    expect(row.status).toBe('published');
  });

  test('published status persists across a fresh read (GET /papers/:id)', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'persist');
    await approve(tokens.super_admin, questions[0].id);
    await publish(tokens.super_admin, paper.id);

    const res = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    expect(res.body.paper.status).toBe('published');
    expect(res.body.questionCounts.approved).toBe(1);
  });
});

describe('Publish gate — candidate-pool eligibility (direct query, per §7/§12; selectPyqPaper() itself is Phase 8)', () => {
  function candidateEligibilityWhere() {
    return { reviewStatus: 'approved', examPaper: { status: 'published' } };
  }

  test('an approved question on a published paper is candidate-pool eligible', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'eligible');
    await approve(tokens.super_admin, questions[0].id);
    await publish(tokens.super_admin, paper.id);

    const eligible = await prisma.question.findMany({ where: { id: questions[0].id, ...candidateEligibilityWhere() } });
    expect(eligible).toHaveLength(1);
  });

  test('a rejected question on a published paper is NEVER candidate-pool eligible', async () => {
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'rejected-not-eligible', q({ questionNumber: '1' }), q({ questionNumber: '2' }));
    await approve(tokens.super_admin, questions[0].id);
    await reject(tokens.super_admin, questions[1].id);
    await publish(tokens.super_admin, paper.id);

    const eligible = await prisma.question.findMany({ where: { id: questions[1].id, ...candidateEligibilityWhere() } });
    expect(eligible).toHaveLength(0);
  });

  test('an approved question on a NOT-YET-published paper is NOT candidate-pool eligible', async () => {
    const { questions } = await uploadAndExtract(tokens.super_admin, 'not-published-yet');
    await approve(tokens.super_admin, questions[0].id);
    // Deliberately never publish this paper.

    const eligible = await prisma.question.findMany({ where: { id: questions[0].id, ...candidateEligibilityWhere() } });
    expect(eligible).toHaveLength(0);
  });

  test('an unreviewed ("extracted") question is never eligible even if its paper later publishes (would require it to be terminal first, per the gate above)', async () => {
    // Realistically the publish gate itself prevents this state from ever
    // reaching a published paper — this test pins the DEFENSE-IN-DEPTH
    // second guarantee (§12's "protection by omission" principle: the
    // eligibility filter itself never trusts ExamPaper.status alone).
    const { paper, questions } = await uploadAndExtract(tokens.super_admin, 'unreviewed-defense', q({ questionNumber: '1' }), q({ questionNumber: '2' }));
    await approve(tokens.super_admin, questions[0].id);
    // questions[1] stays 'extracted' — publish is blocked while it does.
    const blocked = await publish(tokens.super_admin, paper.id);
    expect(blocked.status).toBe(409);

    // Force the paper to 'published' directly (bypassing the route) to prove
    // the eligibility FILTER, not just the publish gate, independently
    // excludes non-approved rows.
    await prisma.examPaper.update({ where: { id: paper.id }, data: { status: 'published' } });
    const eligible = await prisma.question.findMany({ where: { id: questions[1].id, ...candidateEligibilityWhere() } });
    expect(eligible).toHaveLength(0);
  });
});
