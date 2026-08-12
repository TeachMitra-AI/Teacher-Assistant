// PYQ admin ingestion — Phase 2 slice: POST/GET /api/admin/pyq/papers and
// GET /api/admin/pyq/papers/:id/source. Mirrors test/attachments.test.js's
// validation-boundary style, per docs/pyq-implementation-plan.md's own Phase
// 2 "Tests required" line.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

// A real "%PDF-" signature plus one `/Type /Page` marker, matching
// attachments.test.js's own PDF_BYTES fixture exactly — satisfies both
// lib/fileValidation.js's sniffMimeType and estimatePdfPageCount.
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n', 'latin1');
// Same signature, different trailing bytes — a different checksum, still a
// valid one-page PDF, for the "same identity, different bytes" PAPER_EXISTS case.
const PDF_BYTES_VARIANT = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n% variant\n', 'latin1');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

let fixtures;
let tokens;
let board;
let subject;
let subjectWrongClass;
let seq = 0;

/**
 * A fresh, valid one-page PDF buffer, unique bytes every call — checksum
 * dedup (SourceDocument.checksum is globally unique) means any test that
 * expects an independent 201 MUST NOT reuse another test's exact bytes, the
 * same way validFields() below gives every call a unique setLabel so
 * unrelated tests never collide on paper IDENTITY either. Tests that
 * deliberately want a dedup collision pass an explicit, shared buffer
 * instead of relying on this default.
 */
function uniquePdfBytes() {
  seq += 1;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n% unique-${seq}\n`, 'latin1');
}

/** Minimal Board+Subject fixture rows — NOT Phase 5 taxonomy seeding, just a
 * valid FK target for ExamPaper, the same way test/helpers/fixtures.js
 * creates a School before it can create a User. Real syllabus seeding is
 * Phase 5's own deliverable (lib/pyqSyllabusSeed.js), not this test file's. */
async function makeBoardAndSubject(prefix) {
  const b = await prisma.board.create({
    data: { name: `${prefix} Board`, code: `${prefix}BRD`.toUpperCase().slice(0, 20) },
  });
  const s = await prisma.subject.create({
    data: { boardId: b.id, classLevel: '10', name: 'Mathematics' },
  });
  const sWrongClass = await prisma.subject.create({
    data: { boardId: b.id, classLevel: '12', name: 'Physics' },
  });
  return { board: b, subject: s, subjectWrongClass: sWrongClass };
}

function validFields(overrides = {}) {
  seq += 1;
  return {
    boardId: board.id,
    subjectId: subject.id,
    classLevel: '10',
    year: '2020',
    examType: 'annual',
    // Unique per call (part of ExamPaper's identity constraint alongside
    // board/subject/year/examType) so unrelated test cases never collide on
    // paper identity — each test that specifically wants a SHARED identity
    // (the dedup tests below) does so explicitly by reusing one validFields()
    // result across two upload() calls instead of calling it twice.
    setLabel: `T${seq}`,
    language: 'en',
    ...overrides,
  };
}

function upload(token, fields, buffer, filename = 'paper.pdf') {
  let req = request(app).post('/api/admin/pyq/papers').set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach('file', buffer || uniquePdfBytes(), filename);
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqup');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  const created = await makeBoardAndSubject('pyqup');
  board = created.board;
  subject = created.subject;
  subjectWrongClass = created.subjectWrongClass;
});

describe('POST /api/admin/pyq/papers — authentication', () => {
  test('requires a token', async () => {
    const res = await request(app).post('/api/admin/pyq/papers').field('boardId', board.id);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/pyq/papers — RBAC', () => {
  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await upload(tokens[role], validFields());
    expect(res.status).toBe(403);
  });

  test('super_admin is allowed', async () => {
    const res = await upload(tokens.super_admin, validFields());
    expect(res.status).toBe(201);
  });
});

describe('POST /api/admin/pyq/papers — happy path', () => {
  test('creates a paper and stores the PDF byte-for-byte', async () => {
    const buffer = uniquePdfBytes();
    const res = await upload(tokens.super_admin, validFields(), buffer);

    expect(res.status).toBe(201);
    expect(res.body.paper.id).toBeTruthy();
    expect(res.body.paper.board.id).toBe(board.id);
    expect(res.body.paper.subject.id).toBe(subject.id);
    expect(res.body.paper.classLevel).toBe('10');
    expect(res.body.paper.status).toBe('uploaded');
    expect(res.body.paper.sourceDocument.sizeBytes).toBe(buffer.length);
    expect(res.body.paper.sourceDocument.pageCount).toBe(1);
    expect(typeof res.body.requestId).toBe('string');
    // Never leaks raw file bytes in the JSON DTO.
    expect(res.body.paper.sourceDocument.data).toBeUndefined();
  });
});

describe('GET /api/admin/pyq/papers/:id/source — round-trip', () => {
  test('returns the exact same bytes that were uploaded', async () => {
    const buffer = uniquePdfBytes();
    const created = await upload(tokens.super_admin, validFields(), buffer);
    const paperId = created.body.paper.id;

    const res = await request(app)
      .get(`/api/admin/pyq/papers/${paperId}/source`)
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(res.body, buffer)).toBe(0);
  });

  test('requires the same role gate as upload', async () => {
    const created = await upload(tokens.super_admin, validFields());
    const paperId = created.body.paper.id;

    const noAuth = await request(app).get(`/api/admin/pyq/papers/${paperId}/source`);
    expect(noAuth.status).toBe(401);

    const wrongRole = await request(app)
      .get(`/api/admin/pyq/papers/${paperId}/source`)
      .set('Authorization', `Bearer ${tokens.teacher}`);
    expect(wrongRole.status).toBe(403);
  });

  test('404s for an unknown paper id', async () => {
    const res = await request(app)
      .get('/api/admin/pyq/papers/does-not-exist/source')
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/pyq/papers — deduplication', () => {
  test('an exact byte-identical re-upload returns 409 DUPLICATE_UPLOAD', async () => {
    const fields = validFields();
    const buffer = uniquePdfBytes();
    const first = await upload(tokens.super_admin, fields, buffer);
    expect(first.status).toBe(201);

    // Different identity (different year) but IDENTICAL bytes — checksum
    // dedup must fire independently of the identity check.
    const second = await upload(tokens.super_admin, { ...fields, year: String(Number(fields.year) + 1) }, buffer);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_UPLOAD');
  });

  test('a same-identity, different-bytes upload returns 409 PAPER_EXISTS', async () => {
    const fields = validFields();
    const first = await upload(tokens.super_admin, fields);
    expect(first.status).toBe(201);

    const second = await upload(tokens.super_admin, fields, PDF_BYTES_VARIANT);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PAPER_EXISTS');
  });
});

describe('POST /api/admin/pyq/papers — validation', () => {
  test('rejects a missing file', async () => {
    let req = request(app).post('/api/admin/pyq/papers').set('Authorization', `Bearer ${tokens.super_admin}`);
    for (const [key, value] of Object.entries(validFields())) req = req.field(key, value);
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  test('rejects missing required fields', async () => {
    const res = await upload(tokens.super_admin, { classLevel: '10' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('rejects an invalid classLevel', async () => {
    const res = await upload(tokens.super_admin, validFields({ classLevel: '13' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELDS');
  });

  test('rejects a file whose bytes are not a real PDF, regardless of declared type', async () => {
    const res = await upload(tokens.super_admin, validFields(), JPEG_BYTES, 'fake.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects a file larger than PYQ_MAX_FILE_SIZE_MB', async () => {
    const savedLimit = process.env.PYQ_MAX_FILE_SIZE_MB;
    process.env.PYQ_MAX_FILE_SIZE_MB = '1';
    try {
      const big = Buffer.concat([PDF_BYTES, Buffer.alloc(2 * 1024 * 1024)]);
      const res = await upload(tokens.super_admin, validFields(), big);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FILE_TOO_LARGE');
    } finally {
      if (savedLimit === undefined) delete process.env.PYQ_MAX_FILE_SIZE_MB;
      else process.env.PYQ_MAX_FILE_SIZE_MB = savedLimit;
    }
  });

  test('rejects an unknown boardId', async () => {
    const res = await upload(tokens.super_admin, validFields({ boardId: 'does-not-exist' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BOARD');
  });

  test('rejects an unknown subjectId', async () => {
    const res = await upload(tokens.super_admin, validFields({ subjectId: 'does-not-exist' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SUBJECT');
  });

  test('rejects a subject whose classLevel does not match the submitted classLevel', async () => {
    const res = await upload(
      tokens.super_admin,
      validFields({ subjectId: subjectWrongClass.id, classLevel: '10' })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CLASS_LEVEL_MISMATCH');
  });
});

describe('GET /api/admin/pyq/papers — list', () => {
  test('lists papers with pagination envelope', async () => {
    await upload(tokens.super_admin, validFields());

    const res = await request(app)
      .get('/api/admin/pyq/papers')
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .query({ boardId: board.id, limit: 5 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.papers)).toBe(true);
    expect(res.body.papers.length).toBeGreaterThan(0);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.limit).toBe(5);
    for (const p of res.body.papers) expect(p.sourceDocument.data).toBeUndefined();
  });

  test('teacher is denied', async () => {
    const res = await request(app)
      .get('/api/admin/pyq/papers')
      .set('Authorization', `Bearer ${tokens.teacher}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/pyq/papers/:id — detail', () => {
  test('returns paper detail with zeroed extraction/question state', async () => {
    const created = await upload(tokens.super_admin, validFields());
    const paperId = created.body.paper.id;

    const res = await request(app)
      .get(`/api/admin/pyq/papers/${paperId}`)
      .set('Authorization', `Bearer ${tokens.super_admin}`);

    expect(res.status).toBe(200);
    expect(res.body.paper.id).toBe(paperId);
    // No extraction has happened yet in this phase — extractionState is null.
    expect(res.body.extractionProgress).toBeNull();
    expect(res.body.questionCounts).toEqual({ extracted: 0, reviewed: 0, approved: 0, rejected: 0 });
  });

  test('404s for an unknown paper id', async () => {
    const res = await request(app)
      .get('/api/admin/pyq/papers/does-not-exist')
      .set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(404);
  });
});
