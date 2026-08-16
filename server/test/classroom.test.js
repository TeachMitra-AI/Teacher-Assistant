// Classroom Management — classes & students CRUD (docs/classroom-feature-plan.md).
// Mirrors resources.test.js's shape for ownership assertions (404 not 403 on
// a not-owned id) and notifications.test.js's shape for flag manipulation.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const ENV_KEYS = ['CLASSROOM_MANAGEMENT_ENABLED'];
function enableClassroom() {
  process.env.CLASSROOM_MANAGEMENT_ENABLED = 'true';
}

describe('Classroom Management — classes & students', () => {
  let fx;
  let teacherAToken;
  let teacherA2Token;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'clsrm');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherA2Token = await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD);
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    enableClassroom();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function as(token) {
    return (req) => req.set('Authorization', `Bearer ${token}`);
  }

  describe('feature flag off', () => {
    beforeAll(() => { delete process.env.CLASSROOM_MANAGEMENT_ENABLED; });
    afterAll(() => { enableClassroom(); });

    test('every route 503s and creates no row', async () => {
      const before = await prisma.schoolClass.count();
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Class 5-A' }));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('CLASSROOM_MANAGEMENT_DISABLED');
      expect(await prisma.schoolClass.count()).toBe(before);

      const listRes = await as(teacherAToken)(request(app).get('/api/classroom/classes'));
      expect(listRes.status).toBe(503);
    });
  });

  describe('POST /api/classroom/classes', () => {
    test('creates a class owned by the caller', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/classroom/classes').send({ name: 'Class 5-A', grade: 'Class 3-5', section: 'A' })
      );
      expect(res.status).toBe(201);
      expect(res.body.class.name).toBe('Class 5-A');
      expect(res.body.class.archived).toBe(false);
      const row = await prisma.schoolClass.findUnique({ where: { id: res.body.class.id } });
      expect(row.teacherId).toBe(fx.teacherA.id);
      expect(row.schoolId).toBe(fx.schoolA.id);
    });

    test('rejects an empty name', async () => {
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: '' }));
      expect(res.status).toBe(400);
    });

    test('rejects a missing name', async () => {
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ grade: 'Class 3-5' }));
      expect(res.status).toBe(400);
    });

    test('rejects an unknown field (.strict()), including an attempted ownership override', async () => {
      const res = await as(teacherAToken)(
        request(app).post('/api/classroom/classes').send({ name: 'X', teacherId: fx.teacherA2.id })
      );
      expect(res.status).toBe(400);
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/classroom/classes').send({ name: 'No Auth' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/classroom/classes', () => {
    test('lists only the caller\'s own, non-archived classes by default', async () => {
      const mine = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'List Test A' }));
      const theirs = await as(teacherA2Token)(request(app).post('/api/classroom/classes').send({ name: 'List Test A2' }));

      const res = await as(teacherAToken)(request(app).get('/api/classroom/classes'));
      expect(res.status).toBe(200);
      const ids = res.body.classes.map((c) => c.id);
      expect(ids).toContain(mine.body.class.id);
      expect(ids).not.toContain(theirs.body.class.id);
    });

    test('excludes archived classes unless includeArchived=true', async () => {
      const created = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Archive Me' }));
      await as(teacherAToken)(request(app).delete(`/api/classroom/classes/${created.body.class.id}`));

      const withoutArchived = await as(teacherAToken)(request(app).get('/api/classroom/classes'));
      expect(withoutArchived.body.classes.map((c) => c.id)).not.toContain(created.body.class.id);

      const withArchived = await as(teacherAToken)(request(app).get('/api/classroom/classes?includeArchived=true'));
      expect(withArchived.body.classes.map((c) => c.id)).toContain(created.body.class.id);
    });
  });

  describe('GET/PATCH/DELETE /api/classroom/classes/:classId', () => {
    let classId;

    beforeAll(async () => {
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Detail Test' }));
      classId = res.body.class.id;
    });

    test('GET returns the owner\'s class', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}`));
      expect(res.status).toBe(200);
      expect(res.body.class.id).toBe(classId);
    });

    test('GET 404s for a class owned by someone else (not 403 — no existence leak)', async () => {
      const res = await as(teacherA2Token)(request(app).get(`/api/classroom/classes/${classId}`));
      expect(res.status).toBe(404);
    });

    test('GET 404s for an unknown id, identically to not-owned', async () => {
      const res = await as(teacherAToken)(request(app).get('/api/classroom/classes/no-such-id'));
      expect(res.status).toBe(404);
    });

    test('PATCH renames the class', async () => {
      const res = await as(teacherAToken)(request(app).patch(`/api/classroom/classes/${classId}`).send({ name: 'Renamed' }));
      expect(res.status).toBe(200);
      expect(res.body.class.name).toBe('Renamed');
    });

    test('PATCH rejects an empty body', async () => {
      const res = await as(teacherAToken)(request(app).patch(`/api/classroom/classes/${classId}`).send({}));
      expect(res.status).toBe(400);
    });

    test('PATCH 404s for a class owned by someone else', async () => {
      const res = await as(teacherA2Token)(request(app).patch(`/api/classroom/classes/${classId}`).send({ name: 'Hijacked' }));
      expect(res.status).toBe(404);
      const row = await prisma.schoolClass.findUnique({ where: { id: classId } });
      expect(row.name).toBe('Renamed'); // untouched
    });

    test('DELETE soft-deletes (archived: true), never hard-deletes, and is idempotent', async () => {
      const first = await as(teacherAToken)(request(app).delete(`/api/classroom/classes/${classId}`));
      expect(first.status).toBe(200);
      expect(first.body.class.archived).toBe(true);

      const second = await as(teacherAToken)(request(app).delete(`/api/classroom/classes/${classId}`));
      expect(second.status).toBe(200);
      expect(second.body.class.archived).toBe(true);

      const row = await prisma.schoolClass.findUnique({ where: { id: classId } });
      expect(row).not.toBeNull();
    });
  });

  describe('Students', () => {
    let classId;

    beforeAll(async () => {
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Roster Test' }));
      classId = res.body.class.id;
    });

    test('adds a student to the caller\'s own class', async () => {
      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Asha', rollNumber: '1' })
      );
      expect(res.status).toBe(201);
      expect(res.body.student.classId).toBe(classId);
      expect(res.body.student.active).toBe(true);
    });

    test('cannot add a student to a class owned by someone else', async () => {
      const res = await as(teacherA2Token)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Intruder' }));
      expect(res.status).toBe(404);
    });

    test('cannot add a student to an archived class', async () => {
      const archived = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'To Archive' }));
      await as(teacherAToken)(request(app).delete(`/api/classroom/classes/${archived.body.class.id}`));
      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${archived.body.class.id}/students`).send({ name: 'Late Add' })
      );
      expect(res.status).toBe(400);
    });

    test('GET roster excludes inactive students by default, includes with includeInactive=true', async () => {
      const created = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Bala' }));
      await as(teacherAToken)(request(app).delete(`/api/classroom/students/${created.body.student.id}`));

      const active = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/students`));
      expect(active.body.students.map((s) => s.id)).not.toContain(created.body.student.id);

      const all = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/students?includeInactive=true`));
      expect(all.body.students.map((s) => s.id)).toContain(created.body.student.id);
    });

    test('GET roster 404s for a class owned by someone else', async () => {
      const res = await as(teacherA2Token)(request(app).get(`/api/classroom/classes/${classId}/students`));
      expect(res.status).toBe(404);
    });

    test('PATCH a student not owned by the caller 404s', async () => {
      const created = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Chetan' }));
      const res = await as(teacherA2Token)(
        request(app).patch(`/api/classroom/students/${created.body.student.id}`).send({ name: 'Hijacked' })
      );
      expect(res.status).toBe(404);
    });

    test('DELETE (deactivate) a student not owned by the caller 404s and leaves it untouched', async () => {
      const created = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Devika' }));
      const res = await as(teacherA2Token)(request(app).delete(`/api/classroom/students/${created.body.student.id}`));
      expect(res.status).toBe(404);
      const row = await prisma.student.findUnique({ where: { id: created.body.student.id } });
      expect(row.active).toBe(true);
    });
  });
});
