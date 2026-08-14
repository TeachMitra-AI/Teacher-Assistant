// GET /api/pyq/taxonomy, POST /api/resources/generate-pyq — Phase 8
// (docs/pyq-implementation-plan.md §10/§14). Route-level tests against a
// real published+approved corpus, per Phase 8's own Definition of Done.
//
// ExamPaper/Question/QuestionCluster/QuestionClusterMember rows are created
// directly via Prisma, mirroring test/adminPyq.clusters.test.js's own
// established precedent, rather than round-tripping through mocked-Gemini
// extraction: selectPyqPaper() only ever reads already-approved+published
// rows and never touches ingestion/extraction/review, so direct fixtures are
// the right speed/precision trade-off — the same reasoning that file used.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const PYQ_ENV_KEYS = ['PYQ_ENABLED', 'PYQ_ALLOWED_SCHOOL_CODES'];

function enablePyq(overrides = {}) {
  process.env.PYQ_ENABLED = 'true';
  delete process.env.PYQ_ALLOWED_SCHOOL_CODES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearPyqEnv() {
  for (const key of PYQ_ENV_KEYS) delete process.env[key];
}

let fixtures;
let tokens;
let taxSeq = 0;

async function makeTaxonomy(prefix, { classLevel = '10', subjectName = 'Mathematics' } = {}) {
  taxSeq += 1;
  const board = await prisma.board.create({
    data: { name: `${prefix} Board ${taxSeq}`, code: `${prefix}B${taxSeq}`.toUpperCase().slice(0, 24) },
  });
  const subject = await prisma.subject.create({ data: { boardId: board.id, classLevel, name: subjectName } });
  const chapterA = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Algebra', sequence: 1 } });
  const chapterB = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Geometry', sequence: 2 } });
  return {
    board, subject, chapterA, chapterB,
  };
}

let paperSeq = 0;
async function makePaper(board, subject, {
  classLevel = '10', year = 2020, examType = 'annual', published = true,
} = {}) {
  paperSeq += 1;
  return prisma.examPaper.create({
    data: {
      boardId: board.id,
      subjectId: subject.id,
      classLevel,
      year,
      examType,
      setLabel: `s${paperSeq}`,
      status: published ? 'published' : 'needs_review',
    },
  });
}

let questionSeq = 0;
async function makeQuestion(paper, board, subject, chapter, overrides = {}) {
  questionSeq += 1;
  return prisma.question.create({
    data: {
      examPaperId: paper.id,
      boardId: board.id,
      subjectId: subject.id,
      classLevel: paper.classLevel,
      year: paper.year,
      chapterId: chapter ? chapter.id : null,
      questionNumber: String(questionSeq),
      pageNumber: questionSeq,
      language: 'en',
      type: 'short_answer',
      text: `Generated PYQ question ${questionSeq}`,
      marks: 2,
      correctAnswer: 'A model answer.',
      hasOfficialAnswer: true,
      rawExtraction: '{}',
      reviewStatus: 'approved',
      ...overrides,
    },
  });
}

async function makeConfirmedCluster(chapter, questions) {
  const cluster = await prisma.questionCluster.create({ data: { chapterId: chapter.id, method: 'exact', status: 'confirmed' } });
  for (const q of questions) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.questionClusterMember.create({ data: { clusterId: cluster.id, questionId: q.id } });
  }
  return cluster;
}

function genBody(board, subject, overrides = {}) {
  return {
    boardId: board.id,
    classLevel: '10',
    subjectId: subject.id,
    yearFrom: 2015,
    yearTo: 2024,
    totalMarks: 4,
    questionCount: 2,
    prioritizeRecurring: false,
    ...overrides,
  };
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqgen');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
});

beforeEach(() => {
  clearPyqEnv();
});

afterAll(() => {
  clearPyqEnv();
});

describe('POST /api/resources/generate-pyq — rollout gate (§12)', () => {
  test('requires a token', async () => {
    const res = await request(app).post('/api/resources/generate-pyq').send({});
    expect(res.status).toBe(401);
  });

  test('503s (PYQ_DISABLED) when PYQ_ENABLED is unset (default off)', async () => {
    const { board, subject } = await makeTaxonomy('gate1');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PYQ_DISABLED');
  });

  test('503s when enabled but the caller\'s school is outside PYQ_ALLOWED_SCHOOL_CODES', async () => {
    const { board, subject } = await makeTaxonomy('gate2');
    enablePyq({ PYQ_ALLOWED_SCHOOL_CODES: 'SOME_OTHER_SCHOOL_CODE' });
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PYQ_DISABLED');
  });

  test('is reachable (not 503) once enabled with an empty allow-list (empty = all schools)', async () => {
    const { board, subject } = await makeTaxonomy('gate3');
    enablePyq();
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject));
    expect(res.status).not.toBe(503); // no published content yet -> 422, but past the gate
    expect(res.status).toBe(422);
  });

  test('is reachable once enabled with the caller\'s own school explicitly allow-listed', async () => {
    const { board, subject } = await makeTaxonomy('gate4');
    enablePyq({ PYQ_ALLOWED_SCHOOL_CODES: fixtures.schoolA.code });
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject));
    expect(res.status).not.toBe(503);
  });

  test.each(['teacher', 'school_admin', 'resource_person', 'super_admin'])('%s can reach the endpoint — no RBAC beyond authRequired for reading (§12)', async (role) => {
    const { board, subject } = await makeTaxonomy(`gate5${role}`);
    enablePyq();
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens[role]}`)
      .send(genBody(board, subject));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('POST /api/resources/generate-pyq — request validation', () => {
  beforeEach(() => enablePyq());

  test('400s on a missing required field', async () => {
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send({ classLevel: '10' });
    expect(res.status).toBe(400);
  });

  test('400s when yearFrom is after yearTo', async () => {
    const { board, subject } = await makeTaxonomy('val1');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { yearFrom: 2024, yearTo: 2015 }));
    expect(res.status).toBe(400);
  });

  test('400s on an unknown boardId', async () => {
    const { subject } = await makeTaxonomy('val2');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody({ id: 'does-not-exist' }, subject));
    expect(res.status).toBe(400);
  });

  test('400s when the subject does not belong to the given board', async () => {
    const { board: boardA } = await makeTaxonomy('val3a');
    const { subject: subjectB } = await makeTaxonomy('val3b');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(boardA, subjectB));
    expect(res.status).toBe(400);
  });

  test('400s when classLevel does not match the subject\'s own classLevel', async () => {
    const { board, subject } = await makeTaxonomy('val4', { classLevel: '12' });
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { classLevel: '10' }));
    expect(res.status).toBe(400);
  });

  test('400s on an invalid questionType enum value', async () => {
    const { board, subject } = await makeTaxonomy('val5');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { questionType: 'essay' }));
    expect(res.status).toBe(400);
  });

  test('400s on an unrecognized field (mode/typeMix are not part of this contract)', async () => {
    const { board, subject } = await makeTaxonomy('val6');
    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { mode: 'pyq' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/resources/generate-pyq — candidate pool eligibility (§7/§12)', () => {
  beforeEach(() => enablePyq());

  test('a rejected question is never selectable, even on a published paper', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('elig1');
    const paper = await makePaper(board, subject, { year: 2020 });
    await makeQuestion(paper, board, subject, chapterA, { reviewStatus: 'rejected', marks: 2 });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 2, questionCount: 1 }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_PYQ_POOL');
    expect(res.body.diagnostic.found.questions).toBe(0);
  });

  test('an approved question on a NOT-YET-published paper is never selectable', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('elig2');
    const paper = await makePaper(board, subject, { year: 2020, published: false });
    await makeQuestion(paper, board, subject, chapterA, { marks: 2 });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 2, questionCount: 1 }));
    expect(res.status).toBe(422);
    expect(res.body.diagnostic.found.questions).toBe(0);
  });

  test('a question from a DIFFERENT board never leaks into another board\'s paper (isolation)', async () => {
    const { board: boardA, subject: subjectA, chapterA: chA } = await makeTaxonomy('iso1a');
    const { board: boardB, subject: subjectB, chapterA: chB } = await makeTaxonomy('iso1b');
    const paperA = await makePaper(boardA, subjectA, { year: 2020 });
    const qA = await makeQuestion(paperA, boardA, subjectA, chA, { marks: 2 });
    const paperB = await makePaper(boardB, subjectB, { year: 2020 });
    await makeQuestion(paperB, boardB, subjectB, chB, { marks: 2 });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(boardA, subjectA, { totalMarks: 2, questionCount: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.provenance).toHaveLength(1);
    expect(res.body.provenance[0].questionId).toBe(qA.id);
  });

  // Phase 10 "PYQ-only guarantee" integration test (§16): a generation
  // request must never return a question outside its filters. The board
  // case above already proves board isolation; this proves the remaining
  // filter dimensions (subject, classLevel, year range, language) each
  // independently exclude a distractor that matches every OTHER filter.
  test('a generation request never returns a question outside its subject/classLevel/year/language filters', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('guard1');
    const paper = await makePaper(board, subject, { year: 2020 });
    const target = await makeQuestion(paper, board, subject, chapterA, { marks: 2, language: 'en' });

    // Distractor: same board, DIFFERENT subject.
    const otherSubject = await prisma.subject.create({ data: { boardId: board.id, classLevel: '10', name: 'Science' } });
    const otherSubjectChapter = await prisma.chapter.create({ data: { subjectId: otherSubject.id, name: 'Physics', sequence: 1 } });
    const otherSubjectPaper = await makePaper(board, otherSubject, { year: 2020 });
    await makeQuestion(otherSubjectPaper, board, otherSubject, otherSubjectChapter, { marks: 2 });

    // Distractor: same board+subject, DIFFERENT classLevel.
    const otherClassPaper = await makePaper(board, subject, { year: 2020, classLevel: '12' });
    await makeQuestion(otherClassPaper, board, subject, chapterA, { marks: 2 });

    // Distractor: same board+subject+classLevel, year OUTSIDE the requested range.
    const outOfRangePaper = await makePaper(board, subject, { year: 2005 });
    await makeQuestion(outOfRangePaper, board, subject, chapterA, { marks: 2 });

    // Distractor: same board+subject+classLevel+year, DIFFERENT language
    // (the request below omits `language`, which defaults to 'en').
    await makeQuestion(paper, board, subject, chapterA, { marks: 2, language: 'hi' });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 2, questionCount: 1 }));

    expect(res.status).toBe(200);
    expect(res.body.provenance).toHaveLength(1);
    expect(res.body.provenance[0].questionId).toBe(target.id);
  });
});

describe('POST /api/resources/generate-pyq — success path, complete-paper blueprint (§10)', () => {
  beforeEach(() => enablePyq());

  test('returns an exact-marks, exact-count paper with provenance and rendered content', async () => {
    const {
      board, subject, chapterA, chapterB,
    } = await makeTaxonomy('success1');
    const paper1 = await makePaper(board, subject, { year: 2018 });
    const paper2 = await makePaper(board, subject, { year: 2021 });
    const q1 = await makeQuestion(paper1, board, subject, chapterA, { marks: 2, text: 'Solve for x: 2x + 3 = 7.' });
    const q2 = await makeQuestion(paper2, board, subject, chapterB, { marks: 2, text: 'Find the area of a circle of radius 7 cm.' });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 4, questionCount: 2 }));

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeTruthy();
    expect(res.body.provenance).toHaveLength(2);
    expect(res.body.provenance.map((p) => p.questionId).sort()).toEqual([q1.id, q2.id].sort());

    const { content } = res.body;
    expect(content).toContain(subject.name);
    expect(content).toContain(board.name);
    expect(content).toContain('## Instructions');
    expect(content).toContain('## Questions');
    expect(content).toContain('## Answer Key');
    expect(content).toContain(q1.text);
    expect(content).toContain(q2.text);
    expect(content).toContain('**Total marks:** 4');
    expect(content).toContain('**Total questions:** 2');
  });

  test('a question with no official answer prints an explicit "no official answer" line, never a fabricated one', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('success2');
    const paper = await makePaper(board, subject, { year: 2020 });
    await makeQuestion(paper, board, subject, chapterA, {
      marks: 2, hasOfficialAnswer: false, correctAnswer: '',
    });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 2, questionCount: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('No official answer key available in the source.');
  });

  test('filters to the requested questionType only', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('success3');
    const paper = await makePaper(board, subject, { year: 2020 });
    const mcq = await makeQuestion(paper, board, subject, chapterA, {
      marks: 2, type: 'mcq', options: JSON.stringify(['A', 'B', 'C', 'D']),
    });
    await makeQuestion(paper, board, subject, chapterA, { marks: 2, type: 'short_answer' });

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, {
        totalMarks: 2, questionCount: 1, questionType: 'mcq',
      }));
    expect(res.status).toBe(200);
    expect(res.body.provenance[0].questionId).toBe(mcq.id);
  });
});

describe('POST /api/resources/generate-pyq — cluster-based recurrence (§9/§10)', () => {
  beforeEach(() => enablePyq());

  test('at most one member of a confirmed cluster is ever selectable — two clustered rows never both count toward questionCount', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('cluster1');
    const paper1 = await makePaper(board, subject, { year: 2016 });
    const paper2 = await makePaper(board, subject, { year: 2020 });
    const q1 = await makeQuestion(paper1, board, subject, chapterA, { marks: 2, text: 'State the quadratic formula.' });
    const q2 = await makeQuestion(paper2, board, subject, chapterA, { marks: 2, text: 'Write the quadratic formula.' });
    await makeConfirmedCluster(chapterA, [q1, q2]);

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 4, questionCount: 2 }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_PYQ_POOL');
    expect(res.body.diagnostic.found.questions).toBe(1); // the cluster collapses to ONE selectable unit
    expect(res.body.diagnostic.candidatePoolSize).toBe(2); // both rows were real candidates, though
  });

  test('sibling sets of the SAME sitting (same year+examType, different setLabel) collapse to one occurrence, not two', async () => {
    const { board, subject, chapterA } = await makeTaxonomy('cluster2');
    const paperSetA = await makePaper(board, subject, { year: 2020, examType: 'annual' });
    const paperSetB = await makePaper(board, subject, { year: 2020, examType: 'annual' });
    const qSetA = await makeQuestion(paperSetA, board, subject, chapterA, { marks: 2 });
    const qSetB = await makeQuestion(paperSetB, board, subject, chapterA, { marks: 2 });
    await makeConfirmedCluster(chapterA, [qSetA, qSetB]);

    const res = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send(genBody(board, subject, { totalMarks: 2, questionCount: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.provenance).toHaveLength(1);
    // A single-sitting occurrence gets the single-paper phrasing, never the
    // "Asked in ... - y1, y2" multi-year phrasing a real 2-sitting recurrence
    // would use — proving the sitting-tuple dedup fired correctly.
    expect(res.body.provenance[0].source).not.toMatch(/Asked in/);
    expect(res.body.provenance[0].years).toHaveLength(1);
  });

  test('prioritizeRecurring: true and false can select DIFFERENT questions from the same pool, deterministically', async () => {
    const {
      board, subject, chapterA, chapterB,
    } = await makeTaxonomy('cluster3');

    // Recurring: two sittings (2015, 2016), candidate itself dated 2015.
    const paperOld = await makePaper(board, subject, { year: 2015 });
    const paperOlder = await makePaper(board, subject, { year: 2016 });
    const recurring = await makeQuestion(paperOld, board, subject, chapterA, { marks: 3, text: 'Recurring question.' });
    const recurringSibling = await makeQuestion(paperOlder, board, subject, chapterA, { marks: 3, text: 'Recurring question (2016 sitting).' });
    await makeConfirmedCluster(chapterA, [recurring, recurringSibling]);

    // Non-recurring, most recent year in range.
    const paperNew = await makePaper(board, subject, { year: 2024 });
    const recent = await makeQuestion(paperNew, board, subject, chapterB, { marks: 3, text: 'Fresh non-recurring question.' });

    const body = genBody(board, subject, { totalMarks: 3, questionCount: 1 });

    const recurringRes = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send({ ...body, prioritizeRecurring: true });
    expect(recurringRes.status).toBe(200);
    // Either sitting of the recurring cluster is an acceptable winner here
    // (both share the same recurrenceScore, so recency alone breaks the tie
    // between them — 2016 edges out 2015) — the only real assertion is that
    // the CLUSTER wins over the non-recurring 2024 question, and that
    // cluster-dedup still allows only ONE of its two members through.
    expect([recurring.id, recurringSibling.id]).toContain(recurringRes.body.provenance[0].questionId);

    const recentRes = await request(app)
      .post('/api/resources/generate-pyq')
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .send({ ...body, prioritizeRecurring: false });
    expect(recentRes.status).toBe(200);
    expect(recentRes.body.provenance[0].questionId).toBe(recent.id);
  });
});

describe('POST /api/resources/generate-pyq — reproducibility (§9)', () => {
  beforeEach(() => enablePyq());

  test('the same request against an unchanged pool reproduces the identical paper', async () => {
    const { board, subject, chapterA, chapterB } = await makeTaxonomy('repro1');
    const paper1 = await makePaper(board, subject, { year: 2017 });
    const paper2 = await makePaper(board, subject, { year: 2022 });
    await makeQuestion(paper1, board, subject, chapterA, { marks: 2 });
    await makeQuestion(paper2, board, subject, chapterB, { marks: 2 });

    const body = genBody(board, subject, { totalMarks: 4, questionCount: 2 });
    const first = await request(app).post('/api/resources/generate-pyq').set('Authorization', `Bearer ${tokens.teacher}`).send(body);
    const second = await request(app).post('/api/resources/generate-pyq').set('Authorization', `Bearer ${tokens.teacher}`).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.content).toBe(first.body.content);
    expect(second.body.provenance.map((p) => p.questionId)).toEqual(first.body.provenance.map((p) => p.questionId));
  });
});

describe('GET /api/pyq/taxonomy — published-only, rollout-gated (§4/§12/§14)', () => {
  beforeEach(() => enablePyq());

  test('requires a token', async () => {
    const res = await request(app).get('/api/pyq/taxonomy');
    expect(res.status).toBe(401);
  });

  test('503s (PYQ_DISABLED) when the flag is off', async () => {
    clearPyqEnv();
    const res = await request(app).get('/api/pyq/taxonomy').set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PYQ_DISABLED');
  });

  // Phase 10 gap-closing (§12/§20): the rollout allow-list gate was already
  // proven at generate-pyq (the "gate2"/"gate4" cases above) but never at
  // this sibling endpoint — exactly the "worked for upload but missed on the
  // taxonomy endpoint" integration-boundary bug Phase 10's own §20 entry
  // names as its reason for existing.
  test('503s when enabled but the caller\'s school is outside PYQ_ALLOWED_SCHOOL_CODES', async () => {
    enablePyq({ PYQ_ALLOWED_SCHOOL_CODES: 'SOME_OTHER_SCHOOL_CODE' });
    const res = await request(app).get('/api/pyq/taxonomy').set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PYQ_DISABLED');
  });

  test('is reachable once enabled with the caller\'s own school explicitly allow-listed', async () => {
    enablePyq({ PYQ_ALLOWED_SCHOOL_CODES: fixtures.schoolA.code });
    const res = await request(app).get('/api/pyq/taxonomy').set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(200);
  });

  test('a board/subject with zero published papers never appears', async () => {
    const { board } = await makeTaxonomy('tax1');
    const res = await request(app).get('/api/pyq/taxonomy').set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(200);
    expect(res.body.boards.find((b) => b.id === board.id)).toBeUndefined();
  });

  test('a board/subject with >=1 published paper appears with a correct year range', async () => {
    const { board, subject } = await makeTaxonomy('tax2');
    await makePaper(board, subject, { year: 2016 });
    await makePaper(board, subject, { year: 2023 });
    await makePaper(board, subject, { year: 2019, published: false }); // not published — excluded from the range

    const res = await request(app).get('/api/pyq/taxonomy').set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(200);
    const found = res.body.boards.find((b) => b.id === board.id);
    expect(found).toBeTruthy();
    const subj = found.subjects.find((s) => s.id === subject.id);
    expect(subj).toBeTruthy();
    expect(subj.yearRange).toEqual([2016, 2023]);
  });
});
