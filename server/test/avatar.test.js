// Custom profile pictures — POST/DELETE /api/auth/me/avatar and
// GET /api/users/:userId/avatar, end to end. Same scaffolding as
// attachments.test.js: shared test app, real fixtures, real login.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n', 'latin1');
const NOT_A_REAL_FILE = Buffer.from('just some plain text, not a real image');

let fixtures;
let teacherAToken;
let teacherA2Token;

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'avatar');
  teacherAToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  teacherA2Token = await loginAs(app, fixtures.schoolA, fixtures.teacherA2, fixtures.PASSWORD);
});

describe('POST /api/auth/me/avatar — authentication', () => {
  test('requires a token', async () => {
    const res = await request(app).post('/api/auth/me/avatar').attach('photo', JPEG_BYTES, 'me.jpg');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/me/avatar — happy path', () => {
  test('uploading a valid JPEG succeeds and GET /auth/me reflects a non-null avatarUrl', async () => {
    const upload = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'me.jpg');

    expect(upload.status).toBe(200);
    expect(typeof upload.body.user.avatarUrl).toBe('string');
    expect(upload.body.user.avatarUrl).toMatch(new RegExp(`^/users/${fixtures.teacherA.id}/avatar\\?v=\\d+$`));

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${teacherAToken}`);
    expect(me.body.user.avatarUrl).toBe(upload.body.user.avatarUrl);
  });

  test('uploading a valid PNG succeeds', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', PNG_BYTES, 'me.png');
    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).not.toBeNull();
  });

  test('re-uploading replaces the previous image, serving the new bytes at a new versioned URL', async () => {
    const first = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'first.jpg');
    const firstUrl = first.body.user.avatarUrl;

    const second = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', PNG_BYTES, 'second.png');
    const secondUrl = second.body.user.avatarUrl;

    expect(secondUrl).not.toBe(firstUrl);

    const served = await request(app).get(`/api${secondUrl}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body, PNG_BYTES)).toBe(0);
  });
});

describe('POST /api/auth/me/avatar — validation', () => {
  test('rejects a missing file', async () => {
    const res = await request(app).post('/api/auth/me/avatar').set('Authorization', `Bearer ${teacherAToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  test('rejects a file whose bytes do not match any allowed signature, regardless of its declared type', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', NOT_A_REAL_FILE, { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects an empty file', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', Buffer.alloc(0), 'empty.jpg');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  // A PDF is a valid attachment for the Coach feature, but never a valid
  // avatar — the avatar route uses its own narrower allowlist than
  // lib/fileValidation.js's ALLOWED_MIME_TYPES.
  test('rejects a PDF even though the byte-level sniffer recognizes it', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', PDF_BYTES, 'me.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects a file larger than the 5MB cap', async () => {
    const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(6 * 1024 * 1024)]);
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', big, 'big.jpg');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });
});

describe('DELETE /api/auth/me/avatar', () => {
  test('requires a token', async () => {
    const res = await request(app).delete('/api/auth/me/avatar');
    expect(res.status).toBe(401);
  });

  test('clears the caller\'s own picture, falling back to null', async () => {
    await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'me.jpg');

    const res = await request(app).delete('/api/auth/me/avatar').set('Authorization', `Bearer ${teacherAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toBeNull();
  });

  test('never affects another user\'s picture — DELETE only ever scopes to the caller', async () => {
    const upload = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'me.jpg');
    const avatarUrl = upload.body.user.avatarUrl;

    // teacherA2 deletes THEIR OWN (non-existent) avatar — there is no
    // endpoint that takes a target user id, so this is the only way to
    // exercise "another user's delete call" at all.
    await request(app).delete('/api/auth/me/avatar').set('Authorization', `Bearer ${teacherA2Token}`);

    const served = await request(app).get(`/api${avatarUrl}`);
    expect(served.status).toBe(200);
  });
});

describe('GET /api/users/:userId/avatar', () => {
  test('is public — reachable with no Authorization header', async () => {
    const upload = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'me.jpg');

    const res = await request(app).get(`/api${upload.body.user.avatarUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(res.body, JPEG_BYTES)).toBe(0);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  // Regression test: helmet()'s app-wide default Cross-Origin-Resource-Policy
  // is 'same-origin' (see index.js), which silently blocks a plain <img> tag
  // loading this URL from any origin other than the API's own — exactly the
  // deployment shape this app's README describes (client and API as two
  // separately-hosted pieces). Supertest/fetch can't reproduce a browser's
  // CORP enforcement, so this only guards the header is actually present —
  // manual QA in a real browser is what caught the original bug.
  test('opts out of the app-wide same-origin Cross-Origin-Resource-Policy default, so it can be embedded via <img> from a different origin', async () => {
    const upload = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${teacherAToken}`)
      .attach('photo', JPEG_BYTES, 'me.jpg');

    const res = await request(app).get(`/api${upload.body.user.avatarUrl}`);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('404s for a user with no profile picture set', async () => {
    const res = await request(app).get(`/api/users/${fixtures.teacherB.id}/avatar`);
    expect(res.status).toBe(404);
  });
});
