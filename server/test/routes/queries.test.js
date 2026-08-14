// PATCH /api/queries/:id — Sidebar three-dot menu's Rename/Pin, persisted on
// the Query row itself (title, pinned). Also covers GET /api/queries now
// returning both fields.
//
// Covers: auth, ownership (both cross-school and same-school-different-
// teacher, since a Query's owner is a specific user, not a school), input
// validation (trim, empty, max length, boolean type, empty payload), and that
// this stays a narrow title/pinned-only endpoint rather than a generic Query
// update — matching DELETE /api/queries/:id's existing ownership pattern.
const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures, PASSWORD } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');

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
