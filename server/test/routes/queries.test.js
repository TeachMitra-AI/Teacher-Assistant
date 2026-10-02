// PATCH /api/queries/:id: the Sidebar's Rename/Pin, persisted on the Query row (title, pinned), plus GET /api/queries
// returning both fields. Covers auth, ownership (cross-school and same-school-different-teacher, since a Query's owner
// is a user, not a school), input validation (trim, empty, max length, boolean type, empty payload), and that this
// stays a narrow title/pinned-only endpoint, matching DELETE /api/queries/:id's ownership pattern.
const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures, PASSWORD } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('../helpers/geminiMock');

let fixtures;
let tokenA; // teacherA — owns queryA
let tokenA2; // teacherA2 — same school as A, does NOT own queryA
let tokenB; // teacherB — different school, owns queryB

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'patchquery');
  tokenA = await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD);
  tokenA2 = await loginAs(app, fixtures.schoolA, fixtures.teacherA2, PASSWORD);
  tokenB = await loginAs(app, fixtures.schoolB, fixtures.teacherB, PASSWORD);
});

function asToken(token) {
  return (req) => req.set('Authorization', `Bearer ${token}`);
}

describe('PATCH /api/queries/:id', () => {
  test('unauthenticated is rejected', async () => {
    const res = await request(app).patch(`/api/queries/${fixtures.queryA.id}`).send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  test('owner can rename their own chat', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'My renamed chat',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: fixtures.queryA.id, title: 'My renamed chat' });

    const row = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    expect(row.title).toBe('My renamed chat');
  });

  test('owner can pin their own chat', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ pinned: true });
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(true);

    const row = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    expect(row.pinned).toBe(true);
  });

  test('owner can unpin their own chat', async () => {
    await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ pinned: true });
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ pinned: false });
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(false);

    const row = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    expect(row.pinned).toBe(false);
  });

  test('a different account cannot modify this chat', async () => {
    const res = await asToken(tokenB)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'hacked',
    });
    expect(res.status).toBe(403);

    const row = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    expect(row.title).not.toBe('hacked');
  });

  test('another teacher at the SAME school cannot modify this chat either — ownership is per-teacher, not per-school', async () => {
    const res = await asToken(tokenA2)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'hacked',
    });
    expect(res.status).toBe(403);
  });

  test('unknown query id is a 404', async () => {
    const res = await asToken(tokenA)(request(app).patch('/api/queries/does-not-exist')).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test('empty title is rejected', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('whitespace-only title is rejected (trims to empty)', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  test('title is trimmed', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: '  Padded Title  ',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Padded Title');
  });

  test('title over 200 characters is rejected', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'a'.repeat(201),
    });
    expect(res.status).toBe(400);
  });

  test('title at exactly 200 characters is accepted', async () => {
    const title = 'a'.repeat(200);
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ title });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(title);
  });

  test('pinned must be a boolean', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({ pinned: 'yes' });
    expect(res.status).toBe(400);
  });

  test('an empty payload is rejected — nothing to update', async () => {
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({});
    expect(res.status).toBe(400);
  });

  test('arbitrary fields cannot be modified — this is not a generic Query update endpoint', async () => {
    const before = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    const res = await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'Legit rename',
      queryText: 'HACKED QUESTION',
      responseText: 'HACKED ANSWER',
      userId: fixtures.teacherB.id,
    });
    expect(res.status).toBe(200);

    const after = await prisma.query.findUnique({ where: { id: fixtures.queryA.id } });
    expect(after.title).toBe('Legit rename');
    expect(after.queryText).toBe(before.queryText);
    expect(after.responseText).toBe(before.responseText);
    expect(after.userId).toBe(before.userId);
  });
});

describe('GET /api/queries', () => {
  test('returns title and pinned for a renamed, pinned entry', async () => {
    await asToken(tokenA)(request(app).patch(`/api/queries/${fixtures.queryA.id}`)).send({
      title: 'Listed Title',
      pinned: true,
    });

    const res = await asToken(tokenA)(request(app).get('/api/queries'));
    expect(res.status).toBe(200);
    const entry = res.body.queries.find((q) => q.id === fixtures.queryA.id);
    expect(entry).toBeTruthy();
    expect(entry.title).toBe('Listed Title');
    expect(entry.pinned).toBe(true);
  });

  test('title is null and pinned is false for a chat that was never renamed or pinned', async () => {
    const res = await asToken(tokenB)(request(app).get('/api/queries'));
    expect(res.status).toBe(200);
    const entry = res.body.queries.find((q) => q.id === fixtures.queryB.id);
    expect(entry).toBeTruthy();
    expect(entry.title).toBeNull();
    expect(entry.pinned).toBe(false);
  });
});

// A chat thread is several Query rows sharing a conversationId; rename/pin/delete act on the whole thread, and rows
// without a conversationId (history from before threads existed) stay one-turn chats.
describe('conversation threads', () => {
  const CONV = 'conv-thread-test-1';
  const row = (extra) => ({
    userId: fixtures.teacherA.id,
    schoolId: fixtures.schoolA.id,
    queryText: 'q',
    responseText: 'a',
    ...extra,
  });
  const ask = (body) => asToken(tokenA)(request(app).post('/api/coach')).send({ language: 'en', context: {}, ...body });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.query.deleteMany({ where: { userId: fixtures.teacherA.id, queryText: { startsWith: 'thread-' } } });
  });

  test('POST /coach stores the conversationId on each turn and a later turn inherits rename/pin', async () => {
    mockGeminiFetch([geminiSuccess('one'), geminiSuccess('two'), geminiSuccess('three')]);
    const first = await ask({ query: 'thread-1', conversationId: CONV });
    expect(first.status).toBe(200);
    expect(first.body.conversationId).toBe(CONV);

    await asToken(tokenA)(request(app).patch(`/api/queries/${first.body.queryId}`)).send({ title: 'Thread title', pinned: true });
    const second = await ask({ query: 'thread-2', conversationId: CONV });
    await ask({ query: 'thread-3', conversationId: CONV });

    const rows = await prisma.query.findMany({ where: { conversationId: CONV }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.queryText)).toEqual(['thread-1', 'thread-2', 'thread-3']);
    expect(rows.every((r) => r.title === 'Thread title' && r.pinned)).toBe(true);
    expect(second.body.queryId).not.toBe(first.body.queryId);
  });

  test('POST /coach without a conversationId still saves a standalone row; a malformed one is a 400', async () => {
    mockGeminiFetch([geminiSuccess('one')]);
    const ok = await ask({ query: 'thread-solo' });
    expect(ok.status).toBe(200);
    expect(ok.body).not.toHaveProperty('conversationId');
    const saved = await prisma.query.findUnique({ where: { id: ok.body.queryId } });
    expect(saved.conversationId).toBeNull();

    const bad = await ask({ query: 'thread-bad', conversationId: 'has spaces!' });
    expect(bad.status).toBe(400);
  });

  test('GET returns every row of a thread, counts threads (not rows) against limit, and keeps legacy rows', async () => {
    const legacy = await prisma.query.create({ data: row({ queryText: 'thread-legacy' }) });
    for (const n of [1, 2, 3]) await prisma.query.create({ data: row({ queryText: `thread-t${n}`, conversationId: CONV }) });

    const res = await asToken(tokenA)(request(app).get('/api/queries?limit=2'));
    const mine = res.body.queries.filter((q) => q.query.startsWith('thread-'));
    expect(mine.filter((q) => q.conversationId === CONV)).toHaveLength(3);
    expect(mine.find((q) => q.id === legacy.id)).toMatchObject({ conversationId: null });
  });

  test('a pre-thread row can be continued: its id becomes the conversationId and the thread stays one entry', async () => {
    const legacy = await prisma.query.create({ data: row({ queryText: 'thread-old', title: 'Old name' }) });
    mockGeminiFetch([geminiSuccess('next')]);
    const next = await ask({ query: 'thread-new', conversationId: legacy.id });
    expect(next.status).toBe(200);
    expect((await prisma.query.findUnique({ where: { id: next.body.queryId } })).title).toBe('Old name');

    const res = await asToken(tokenA)(request(app).get('/api/queries'));
    expect(res.body.queries.filter((q) => q.query.startsWith('thread-')).map((q) => q.query).sort()).toEqual(['thread-new', 'thread-old']);

    await asToken(tokenA)(request(app).delete(`/api/queries/${legacy.id}`));
    expect(await prisma.query.count({ where: { userId: fixtures.teacherA.id, queryText: { startsWith: 'thread-' } } })).toBe(0);
  });

  test('PATCH and DELETE apply to the whole thread, not other rows or other users', async () => {
    const a = await prisma.query.create({ data: row({ queryText: 'thread-a', conversationId: CONV }) });
    await prisma.query.create({ data: row({ queryText: 'thread-b', conversationId: CONV }) });
    const other = await prisma.query.create({ data: row({ queryText: 'thread-other' }) });
    const theirs = await prisma.query.create({
      data: { ...row({ queryText: 'thread-theirs', conversationId: CONV }), userId: fixtures.teacherB.id, schoolId: fixtures.schoolB.id },
    });

    const patch = await asToken(tokenA)(request(app).patch(`/api/queries/${a.id}`)).send({ title: 'T', pinned: true });
    expect(patch.status).toBe(200);
    const patched = await prisma.query.findMany({ where: { conversationId: CONV, userId: fixtures.teacherA.id } });
    expect(patched.every((r) => r.title === 'T' && r.pinned)).toBe(true);
    expect((await prisma.query.findUnique({ where: { id: other.id } })).title).toBeNull();
    expect((await prisma.query.findUnique({ where: { id: theirs.id } })).title).toBeNull();

    const del = await asToken(tokenA)(request(app).delete(`/api/queries/${a.id}`));
    expect(del.status).toBe(200);
    expect(await prisma.query.count({ where: { conversationId: CONV, userId: fixtures.teacherA.id } })).toBe(0);
    expect(await prisma.query.findUnique({ where: { id: other.id } })).toBeTruthy();
    expect(await prisma.query.findUnique({ where: { id: theirs.id } })).toBeTruthy();
    await prisma.query.delete({ where: { id: theirs.id } });
  });
});
