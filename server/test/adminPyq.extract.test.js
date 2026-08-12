// PYQ per-page extraction — Phase 3. Route-level tests for
// POST /api/admin/pyq/papers/:id/extract, mirroring
// test/adminPyq.upload.test.js's fixture style and
// test/coach.reliability.test.js's mockGeminiFetch-driven reliability style.
// Covers: valid extraction, malformed AI output, Zod validation failure,
// Gemini/API failure + retry, page-level failure isolation, idempotency,
// provenance/page-number preservation, authorization, and no sensitive
// content leakage in logs.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited } = require('./helpers/geminiMock');

// One-page PDF (single `/Type /Page` marker) — matches adminPyq.upload.test.js's
// own fixture convention exactly.
function onePagePdf(tag) {
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n% ${tag}\n`, 'latin1');
}
// Two-page PDF — two markers, so estimatePdfPageCount reports 2.
function twoPagePdf(tag) {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n% ${tag}\n`,
    'latin1'
  );
}

let fixtures;
let tokens;
let board;
let subject;
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

function extract(token, paperId, body) {
  return request(app)
    .post(`/api/admin/pyq/papers/${paperId}/extract`)
    .set('Authorization', `Bearer ${token}`)
    .send(body || {});
}

function pageWith(...questions) {
  return geminiSuccess(JSON.stringify({ questions }));
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

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqex');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  const created = await makeBoardAndSubject('pyqex');
  board = created.board;
  subject = created.subject;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/pyq/papers/:id/extract — authentication & RBAC', () => {
  test('requires a token', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('auth'));
    const res = await request(app).post(`/api/admin/pyq/papers/${paper.id}/extract`).send({});
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf(`rbac-${role}`));
    const res = await extract(tokens[role], paper.id, {});
    expect(res.status).toBe(403);
  });

  test('404s for an unknown paper id', async () => {
    const res = await extract(tokens.super_admin, 'does-not-exist', {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — valid extraction', () => {
  test('creates Question rows with correct provenance and marks the paper needs_review', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('happy'));
    mockGeminiFetch([
      pageWith(
        q({ questionNumber: '1', text: 'What is $5/9$ of 45?', marks: 2 }),
        q({ questionNumber: '2', type: 'mcq', options: ['A', 'B', 'C', 'D'], marks: 1 })
      ),
    ]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);
    expect(res.body.pageNumber).toBe(1);
    expect(res.body.status).toBe('done');
    expect(typeof res.body.requestId).toBe('string');

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id }, orderBy: { questionNumber: 'asc' } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.pageNumber).toBe(1);
      expect(row.examPaperId).toBe(paper.id);
      expect(row.boardId).toBe(paper.board.id);
      expect(row.subjectId).toBe(paper.subject.id);
      expect(row.classLevel).toBe(paper.classLevel);
      expect(row.year).toBe(paper.year);
      expect(row.reviewStatus).toBe('extracted');
      expect(typeof row.rawExtraction).toBe('string');
      expect(row.extractionConfidence).toBeCloseTo(0.92);
    }
    expect(rows[0].text).toContain('\\frac'); // math notation converted
    expect(rows[1].options && JSON.parse(rows[1].options)).toEqual(['A', 'B', 'C', 'D']);

    const detail = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(detail.body.paper.status).toBe('needs_review');
    expect(detail.body.questionCounts.extracted).toBe(2);
  });

  test('never persists correctAnswer/leaves hasOfficialAnswer honest when the model contradicts itself', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('trust-boundary'));
    // hasOfficialAnswer:false but a non-empty correctAnswer anyway — passes Zod
    // (only hasOfficialAnswer:true constrains correctAnswer), but the app-level
    // rule in lib/pyqWorker.js must still refuse to persist it.
    mockGeminiFetch([pageWith(q({ hasOfficialAnswer: false, correctAnswer: 'x = 2' }))]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);

    const [row] = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(row.hasOfficialAnswer).toBe(false);
    expect(row.correctAnswer).toBeNull();
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — malformed AI output', () => {
  test('non-JSON Gemini text returns 502 INVALID_AI_RESPONSE and marks the page failed', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('malformed'));
    mockGeminiFetch([geminiSuccess('not valid json{{{')]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(rows).toHaveLength(0);

    const detail = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(detail.body.extractionProgress).toEqual({ pending: 0, done: 0, failed: 1 });
    expect(detail.body.paper.status).toBe('extraction_failed');
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — Zod validation failure', () => {
  test('well-formed JSON that fails schema validation (mcq with 3 options) returns 502 INVALID_AI_RESPONSE', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('zod-fail'));
    mockGeminiFetch([pageWith(q({ type: 'mcq', options: ['A', 'B', 'C'] }))]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(rows).toHaveLength(0);
  });

  test('a missing required field returns 502 INVALID_AI_RESPONSE', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('zod-fail-2'));
    const broken = q();
    delete broken.marks;
    mockGeminiFetch([pageWith(broken)]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — Gemini/API failure and retry', () => {
  test('exhausted rate limiting returns 429 RATE_LIMITED and leaves the page pending (retriable)', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('rate-limited'));
    mockGeminiFetch([geminiRateLimited()]); // repeats for every call → exhausts retries

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(rows).toHaveLength(0);
    const detail = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    // Never marked 'failed' by a transient/quota condition — still retriable.
    expect(detail.body.extractionProgress).toEqual({ pending: 1, done: 0, failed: 0 });
    // The attempt itself (not its outcome) moves the paper out of 'uploaded' —
    // 'extracting' is the normal, expected mid-pipeline state (§7).
    expect(detail.body.paper.status).toBe('extracting');
  });

  test('a transient 429 then success is transparent — the page still extracts', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('retry-then-success'));
    mockGeminiFetch([geminiRateLimited(), pageWith(q())]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(202);

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(rows).toHaveLength(1);
  }, 15000);

  test('repeated upstream 5xx returns 502 UPSTREAM_UNAVAILABLE', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('upstream-5xx'));
    mockGeminiFetch([{ status: 503, text: 'internal upstream detail' }]);

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE');
    // Never leaks the raw upstream error body to the client.
    expect(JSON.stringify(res.body)).not.toContain('internal upstream detail');
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — page-level isolation', () => {
  test('one page failing does not affect another page already extracted', async () => {
    const paper = await uploadPaper(tokens.super_admin, twoPagePdf('isolation'));

    mockGeminiFetch([pageWith(q({ questionNumber: '1' }))]);
    const first = await extract(tokens.super_admin, paper.id, { page: 1 });
    expect(first.status).toBe(202);

    vi.unstubAllGlobals();
    mockGeminiFetch([geminiSuccess('not valid json')]);
    const second = await extract(tokens.super_admin, paper.id, { page: 2 });
    expect(second.status).toBe(502);

    const page1Rows = await prisma.question.findMany({ where: { examPaperId: paper.id, pageNumber: 1 } });
    expect(page1Rows).toHaveLength(1);
    const page2Rows = await prisma.question.findMany({ where: { examPaperId: paper.id, pageNumber: 2 } });
    expect(page2Rows).toHaveLength(0);

    const detail = await request(app)
      .get(`/api/admin/pyq/papers/${paper.id}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    // One done, one failed — still "extracting" is wrong (nothing pending), and
    // not "extraction_failed" either (not EVERY page failed) — needs_review.
    expect(detail.body.paper.status).toBe('needs_review');
    expect(detail.body.extractionProgress).toEqual({ pending: 0, done: 1, failed: 1 });
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — idempotency', () => {
  test('re-extracting the same unreviewed page replaces rows, never duplicates them', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('idempotent'));

    mockGeminiFetch([pageWith(q({ questionNumber: '1' }), q({ questionNumber: '2' }))]);
    const first = await extract(tokens.super_admin, paper.id, { page: 1 });
    expect(first.status).toBe(202);
    expect(await prisma.question.count({ where: { examPaperId: paper.id } })).toBe(2);

    vi.unstubAllGlobals();
    mockGeminiFetch([pageWith(q({ questionNumber: '1' }))]);
    const second = await extract(tokens.super_admin, paper.id, { page: 1 });
    expect(second.status).toBe(202);

    const rows = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    expect(rows).toHaveLength(1); // replaced, not appended to the first extraction's 2 rows
  });

  test('a page with an already-reviewed question refuses re-extraction (409 PAGE_ALREADY_REVIEWED)', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('reviewed-guard'));
    mockGeminiFetch([pageWith(q())]);
    await extract(tokens.super_admin, paper.id, { page: 1 });

    const [row] = await prisma.question.findMany({ where: { examPaperId: paper.id } });
    await prisma.question.update({ where: { id: row.id }, data: { reviewStatus: 'approved' } });

    const res = await extract(tokens.super_admin, paper.id, { page: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAGE_ALREADY_REVIEWED');
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — validation & state guards', () => {
  test('rejects a non-integer / non-positive page', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('bad-page'));
    const res = await extract(tokens.super_admin, paper.id, { page: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('rejects a page beyond the known page count', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('out-of-range'));
    const res = await extract(tokens.super_admin, paper.id, { page: 99 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('409 NOTHING_TO_EXTRACT once every known page is done', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('nothing-left'));
    mockGeminiFetch([pageWith(q())]);
    await extract(tokens.super_admin, paper.id, {});

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOTHING_TO_EXTRACT');
  });

  test('409 NOT_EXTRACTABLE once a paper is published/archived', async () => {
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('published'));
    await prisma.examPaper.update({ where: { id: paper.id }, data: { status: 'published' } });

    const res = await extract(tokens.super_admin, paper.id, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_EXTRACTABLE');
  });
});

describe('POST /api/admin/pyq/papers/:id/extract — no sensitive content leakage in logs', () => {
  test('neither the extracted question text nor the raw Gemini response body is ever logged', async () => {
    const secretText = 'UNIQUE_SECRET_QUESTION_TEXT_MARKER_998877';
    const paper = await uploadPaper(tokens.super_admin, onePagePdf('log-safety'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockGeminiFetch([pageWith(q({ text: secretText }))]);
      await extract(tokens.super_admin, paper.id, {});

      vi.unstubAllGlobals();
      mockGeminiFetch([geminiSuccess('not json')]);
      await extract(tokens.super_admin, paper.id, {});

      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
      const serialized = JSON.stringify(allCalls);
      expect(serialized).not.toContain(secretText);
      expect(serialized).not.toContain('not json');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
