// PYQ cluster review — Phase 6. Route-level tests for GET /clusters,
// POST /clusters/:id/confirm, POST /clusters/:id/reject. Mirrors
// adminPyq.review.test.js's fixture/RBAC style exactly.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

let fixtures;
let tokens;
let board;
let subject;
let chapter;
let seq = 0;

async function makeTaxonomy(prefix) {
  seq += 1;
  const b = await prisma.board.create({ data: { name: `${prefix} Board`, code: `${prefix}BRD${seq}`.toUpperCase().slice(0, 24) } });
  const s = await prisma.subject.create({ data: { boardId: b.id, classLevel: '10', name: 'Mathematics' } });
  const c = await prisma.chapter.create({ data: { subjectId: s.id, name: 'Circles', sequence: 1 } });
  return { board: b, subject: s, chapter: c };
}

let qSeq = 0;
async function makeCluster({ method = 'exact', status = 'proposed', memberCount = 2 } = {}) {
  qSeq += 1;
  const examPaper = await prisma.examPaper.create({
    data: { boardId: board.id, subjectId: subject.id, classLevel: '10', year: 2020, examType: 'annual', setLabel: `cl${qSeq}` },
  });
  const cluster = await prisma.questionCluster.create({ data: { chapterId: chapter.id, method, status } });
  const questions = [];
  for (let i = 0; i < memberCount; i += 1) {
    const q = await prisma.question.create({
      data: {
        examPaperId: examPaper.id, boardId: board.id, subjectId: subject.id, classLevel: '10', year: 2020 + i,
        questionNumber: String(i + 1), language: 'en', type: 'short_answer', text: `Cluster question ${qSeq}-${i}`,
        marks: 2, rawExtraction: '{}', reviewStatus: 'approved', chapterId: chapter.id,
      },
    });
    questions.push(q);
    await prisma.questionClusterMember.create({ data: { clusterId: cluster.id, questionId: q.id, similarity: method === 'semantic' ? 0.9 : null } });
  }
  return { cluster, questions };
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'pyqclusters');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
  const created = await makeTaxonomy('pyqclusters');
  board = created.board;
  subject = created.subject;
  chapter = created.chapter;
});

describe('GET /api/admin/pyq/clusters', () => {
  test('requires a token', async () => {
    const res = await request(app).get('/api/admin/pyq/clusters');
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await request(app).get('/api/admin/pyq/clusters').set('Authorization', `Bearer ${tokens[role]}`);
    expect(res.status).toBe(403);
  });

  test('super_admin lists clusters with members, recurrence, and a computed reference question', async () => {
    const { cluster, questions } = await makeCluster({ memberCount: 2 });
    const res = await request(app).get('/api/admin/pyq/clusters').set('Authorization', `Bearer ${tokens.super_admin}`).query({ chapterId: chapter.id });
    expect(res.status).toBe(200);
    const found = res.body.clusters.find((c) => c.id === cluster.id);
    expect(found).toBeTruthy();
    expect(found.members).toHaveLength(2);
    expect(found.members.map((m) => m.questionId).sort()).toEqual(questions.map((q) => q.id).sort());
    expect(found.referenceQuestionId).toBe(questions[0].id); // earlier year (2020) wins over 2021
    expect(found.recurrence.count).toBe(2);
    expect(found.recurrence.years).toEqual([2020, 2021]);
  });

  test('filters by status', async () => {
    const { cluster: proposed } = await makeCluster({ status: 'proposed' });
    const { cluster: confirmed } = await makeCluster({ status: 'confirmed' });
    const res = await request(app)
      .get('/api/admin/pyq/clusters')
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .query({ chapterId: chapter.id, status: 'confirmed' });
    const ids = res.body.clusters.map((c) => c.id);
    expect(ids).toContain(confirmed.id);
    expect(ids).not.toContain(proposed.id);
  });

  test('filters by chapterId', async () => {
    const other = await makeTaxonomy('pyqclustersother');
    const otherCluster = await prisma.questionCluster.create({ data: { chapterId: other.chapter.id, method: 'exact', status: 'proposed' } });
    const res = await request(app)
      .get('/api/admin/pyq/clusters')
      .set('Authorization', `Bearer ${tokens.super_admin}`)
      .query({ chapterId: chapter.id });
    expect(res.body.clusters.map((c) => c.id)).not.toContain(otherCluster.id);
  });
});

describe('POST /api/admin/pyq/clusters/:id/confirm', () => {
  test('requires a token', async () => {
    const { cluster } = await makeCluster();
    const res = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/confirm`).send();
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { cluster } = await makeCluster();
    const res = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/confirm`).set('Authorization', `Bearer ${tokens[role]}`).send();
    expect(res.status).toBe(403);
  });

  test('404s for an unknown cluster id', async () => {
    const res = await request(app).post('/api/admin/pyq/clusters/does-not-exist/confirm').set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res.status).toBe(404);
  });

  test('confirms a proposed cluster, recording who and when', async () => {
    const { cluster } = await makeCluster({ status: 'proposed' });
    const res = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/confirm`).set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    const updated = await prisma.questionCluster.findUnique({ where: { id: cluster.id } });
    expect(updated.confirmedById).toBe(fixtures.superAdmin.id);
    expect(updated.confirmedAt).toBeTruthy();
  });

  test('409s on a second confirm, and on confirming an already-rejected cluster', async () => {
    const { cluster: alreadyConfirmed } = await makeCluster({ status: 'confirmed' });
    const res1 = await request(app).post(`/api/admin/pyq/clusters/${alreadyConfirmed.id}/confirm`).set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res1.status).toBe(409);
    expect(res1.body.code).toBe('ALREADY_DECIDED');

    const { cluster: rejected } = await makeCluster({ status: 'rejected' });
    const res2 = await request(app).post(`/api/admin/pyq/clusters/${rejected.id}/confirm`).set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res2.status).toBe(409);
  });
});

describe('POST /api/admin/pyq/clusters/:id/reject', () => {
  test('requires a token', async () => {
    const { cluster } = await makeCluster();
    const res = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/reject`).send();
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const { cluster } = await makeCluster();
    const res = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/reject`).set('Authorization', `Bearer ${tokens[role]}`).send();
    expect(res.status).toBe(403);
  });

  test('404s for an unknown cluster id', async () => {
    const res = await request(app).post('/api/admin/pyq/clusters/does-not-exist/reject').set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res.status).toBe(404);
  });

  test('is unconditional — reverses an already-confirmed cluster (no 409), and is idempotent on an already-rejected one', async () => {
    const { cluster } = await makeCluster({ status: 'confirmed' });
    const res1 = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/reject`).set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('rejected');

    const res2 = await request(app).post(`/api/admin/pyq/clusters/${cluster.id}/reject`).set('Authorization', `Bearer ${tokens.super_admin}`).send();
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('rejected');
  });
});
