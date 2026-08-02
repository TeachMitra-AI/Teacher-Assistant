// POST /api/coach/attachment, end to end. Mirrors assistant.catalog.test.js's
// approach to flag manipulation: env vars are read per-request by the route,
// so tests drive the single shared app instance by flipping process.env
// between tests rather than rebuilding the app.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess, geminiRateLimited, geminiInputBlocked } = require('./helpers/geminiMock');

const ATTACHMENT_ENV_KEYS = [
  'ATTACHMENTS_ENABLED',
  'ATTACHMENT_ALLOWED_SCHOOL_CODES',
  'ATTACHMENT_MAX_FILE_SIZE_MB',
  'ATTACHMENT_MAX_PDF_PAGES',
  'ATTACHMENT_MAX_FILES',
  'ATTACHMENT_MAX_TOTAL_SIZE_MB',
];

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n', 'latin1');
const NOT_A_REAL_FILE = Buffer.from('just some plain text, not a real image or pdf');

let fixtures;
let teacherToken;
let savedEnv;

function enableAttachments(overrides = {}) {
  process.env.ATTACHMENTS_ENABLED = 'true';
  delete process.env.ATTACHMENT_ALLOWED_SCHOOL_CODES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearAttachmentEnv() {
  for (const key of ATTACHMENT_ENV_KEYS) delete process.env[key];
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'attach');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ATTACHMENT_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearAttachmentEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/coach/attachment — authentication', () => {
  test('requires a token', async () => {
    const res = await request(app)
      .post('/api/coach/attachment')
      .field('query', 'Solve Question 5')
      .attach('files', JPEG_BYTES, 'question.jpg');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/coach/attachment — disabled by default', () => {
  test('an unconfigured deployment returns 503 without ever touching Gemini', async () => {
    const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Solve Question 5')
      .attach('files', JPEG_BYTES, 'question.jpg');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ATTACHMENTS_DISABLED');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('POST /api/coach/attachment — happy path: single file (backward compatible)', () => {
  test('answers a question about one attached image', async () => {
    enableAttachments();
    mockGeminiFetch([geminiSuccess('Question 5 is solved by adding 2 and 3 to get 5.')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Solve Question 5')
      .field('language', 'en')
      .attach('files', JPEG_BYTES, 'question.jpg');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.text).toContain('Question 5 is solved');
    expect(res.body.language).toBe('en');
    expect(res.body.queryId).toBeNull();
    expect(typeof res.body.requestId).toBe('string');
  });

  test('answers a question about one attached PDF', async () => {
    enableAttachments();
    mockGeminiFetch([geminiSuccess('This chapter covers fractions and decimals.')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Summarize this chapter')
      .attach('files', PDF_BYTES, 'chapter.pdf');

    expect(res.status).toBe(200);
    expect(res.body.text).toContain('fractions');
  });
});

describe('POST /api/coach/attachment — happy path: multiple attachments in ONE request', () => {
  test('sends multiple images in one call and returns one combined answer', async () => {
    enableAttachments();
    const { mock, calls } = mockGeminiFetch([geminiSuccess('Both pages together show a complete word problem.')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain these two pages together')
      .attach('files', JPEG_BYTES, 'page1.jpg')
      .attach('files', PNG_BYTES, 'page2.png');

    expect(res.status).toBe(200);
    expect(res.body.text).toContain('Both pages together');
    // Exactly ONE Gemini call for the whole message, carrying both files.
    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0].body.contents[0].parts).toHaveLength(3); // text + 2 images
  });

  test('sends a mix of images and a PDF in one call', async () => {
    enableAttachments();
    const { mock, calls } = mockGeminiFetch([geminiSuccess('The worksheet and the answer key match.')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Do these match?')
      .attach('files', JPEG_BYTES, 'worksheet.jpg')
      .attach('files', PDF_BYTES, 'answerkey.pdf');

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0].body.contents[0].parts).toHaveLength(3); // text + image + pdf
    expect(calls[0].body.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(calls[0].body.contents[0].parts[2].inlineData.mimeType).toBe('application/pdf');
  });
});

describe('POST /api/coach/attachment — validation', () => {
  test('rejects a missing file', async () => {
    enableAttachments();
    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Solve Question 5');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  test('rejects a missing query', async () => {
    enableAttachments();
    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('files', JPEG_BYTES, 'question.jpg');
    expect(res.status).toBe(400);
  });

  test('rejects a file whose bytes do not match any allowed signature, regardless of its declared type', async () => {
    enableAttachments();
    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      // supertest lets us declare an image content-type for non-image bytes —
      // exactly the spoofing scenario the magic-byte sniff exists to catch.
      .attach('files', NOT_A_REAL_FILE, { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects the WHOLE request if one file in a multi-file batch is invalid', async () => {
    enableAttachments();
    const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain these')
      .attach('files', JPEG_BYTES, 'good.jpg')
      .attach('files', NOT_A_REAL_FILE, { filename: 'bad.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(mock).not.toHaveBeenCalled();
  });

  test('rejects a file larger than ATTACHMENT_MAX_FILE_SIZE_MB', async () => {
    enableAttachments({ ATTACHMENT_MAX_FILE_SIZE_MB: '1' });
    const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(2 * 1024 * 1024)]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      .attach('files', big, 'big.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });

  test('rejects a batch exceeding ATTACHMENT_MAX_FILES', async () => {
    enableAttachments({ ATTACHMENT_MAX_FILES: '2' });

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain these')
      .attach('files', JPEG_BYTES, 'a.jpg')
      .attach('files', PNG_BYTES, 'b.png')
      .attach('files', PDF_BYTES, 'c.pdf');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_FILES');
  });

  test('rejects a batch whose combined size exceeds ATTACHMENT_MAX_TOTAL_SIZE_MB, even though each file is individually within the per-file cap', async () => {
    enableAttachments({ ATTACHMENT_MAX_FILE_SIZE_MB: '2', ATTACHMENT_MAX_TOTAL_SIZE_MB: '3' });
    // Each file: ~1.53MB (comfortably under the 2MB per-file cap). Combined:
    // ~3.05MB (comfortably over the 3MB total cap) — a safe margin either way
    // so this isn't a boundary-flake.
    const eachFile = () => Buffer.concat([JPEG_BYTES, Buffer.alloc(1_600_000)]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain these')
      .attach('files', eachFile(), 'a.jpg')
      .attach('files', eachFile(), 'b.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BATCH_TOO_LARGE');
  });

  test('rejects an unsupported language', async () => {
    enableAttachments();
    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      .field('language', 'not-a-real-language')
      .attach('files', JPEG_BYTES, 'question.jpg');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/coach/attachment — upstream failure mapping', () => {
  test('an upstream 429 storm maps to 429 RATE_LIMITED, not a raw 5xx', async () => {
    enableAttachments();
    mockGeminiFetch([geminiRateLimited(), geminiRateLimited(), geminiRateLimited()]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      .attach('files', JPEG_BYTES, 'question.jpg');

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  test('an input safety block maps to 422 SAFETY_BLOCKED', async () => {
    enableAttachments();
    mockGeminiFetch([geminiInputBlocked()]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      .attach('files', JPEG_BYTES, 'question.jpg');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SAFETY_BLOCKED');
  });
});

describe('POST /api/coach/attachment — rollout: school allow-list', () => {
  test('a school not on the allow-list is treated the same as disabled', async () => {
    enableAttachments({ ATTACHMENT_ALLOWED_SCHOOL_CODES: 'SOME-OTHER-SCHOOL' });
    const { mock } = mockGeminiFetch([geminiSuccess('should never be called')]);

    const res = await request(app)
      .post('/api/coach/attachment')
      .set('Authorization', `Bearer ${teacherToken}`)
      .field('query', 'Explain this')
      .attach('files', JPEG_BYTES, 'question.jpg');

    expect(res.status).toBe(503);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('POST /api/coach/attachment — existing Coach text path is unaffected', () => {
  test('POST /api/coach still works exactly as before, with attachments left fully disabled', async () => {
    clearAttachmentEnv(); // attachments OFF
    mockGeminiFetch([geminiSuccess('A normal coaching answer.')]);

    const res = await request(app)
      .post('/api/coach')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ query: 'How do I explain fractions to Class 5?', language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.text).toBe('A normal coaching answer.');
  });
});
