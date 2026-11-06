// Classroom Management classes and students CRUD (docs/classroom-feature-plan.md). Follows resources.test.js for
// ownership assertions (404, not 403, on a not-owned id) and notifications.test.js for flag manipulation.
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

    // Regression: this router mounts at the bare `/api` and its routes self-prefix with `/classroom/...` (see index.js),
    // so the disabled-feature gate must be per route (the `gate` array in routes/classroom.js), never a router-wide
    // `router.use()`. A router-wide gate would run for any path that falls through to this router and, since it 503s
    // without calling next(), would swallow unrelated unmatched paths (e.g. `/api/assistant/not-a-real-endpoint`) with a 503
    // instead of Express's 404. CI caught this when assistant.catalog.test.js's "unknown assistant path" assertions failed
    // with 503 whenever CLASSROOM_MANAGEMENT_ENABLED was unset.
    test('a disabled Classroom does not swallow an unrelated, nonexistent API path', async () => {
      const res = await as(teacherAToken)(request(app).get('/api/definitely-not-a-real-endpoint'));
      expect(res.status).toBe(404);
      expect(res.body.code).not.toBe('CLASSROOM_MANAGEMENT_DISABLED');
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

  describe('Roll numbers', () => {
    let classId;
    let otherClassId;

    async function makeClass(name) {
      const res = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name }));
      return res.body.class.id;
    }

    function addStudent(name, rollNumber, targetClassId = classId) {
      return as(teacherAToken)(request(app).post(`/api/classroom/classes/${targetClassId}/students`).send({ name, rollNumber }));
    }

    function patchStudent(id, body, token = teacherAToken) {
      return as(token)(request(app).patch(`/api/classroom/students/${id}`).send(body));
    }

    beforeEach(async () => {
      classId = await makeClass('Roll Numbers');
      otherClassId = await makeClass('Roll Numbers Other');
    });

    test('lists students numerically, then other roll numbers, then none', async () => {
      await addStudent('No Roll', undefined);
      await addStudent('Ten', '10');
      await addStudent('Letter', 'A1');
      await addStudent('Two', '2');
      await addStudent('One Hundred', '100');

      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/students`));
      expect(res.body.students.map((s) => s.name)).toEqual(['Two', 'Ten', 'One Hundred', 'Letter', 'No Roll']);
    });

    test.each([
      ['an identical roll number', '7', '7'],
      ['leading zeros', '1', '01'],
      ['all zeros', '0', '00'],
      ['different letter case', 'a1', 'A1'],
    ])('POST rejects a duplicate in the same class: %s', async (_label, first, second) => {
      expect((await addStudent('First', first)).status).toBe(201);
      const res = await addStudent('Second', second);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(`Roll number ${second} is already used in this class.`);
      expect(await prisma.student.count({ where: { classId } })).toBe(1);
    });

    test('the same roll number is allowed in a different class', async () => {
      expect((await addStudent('First', '5')).status).toBe(201);
      expect((await addStudent('Second', '5', otherClassId)).status).toBe(201);
    });

    test('students with no roll number never conflict', async () => {
      expect((await addStudent('First', undefined)).status).toBe(201);
      expect((await addStudent('Second', undefined)).status).toBe(201);
      expect((await addStudent('Third', '')).status).toBe(201);
      expect((await addStudent('Fourth', '')).status).toBe(201);
    });

    test('concurrent duplicates: the database lets exactly one through', async () => {
      const results = await Promise.all([addStudent('First', '9'), addStudent('Second', '9')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.student.count({ where: { classId } })).toBe(1);
    });

    test('PATCH onto a taken roll number 409s and changes nothing', async () => {
      await addStudent('First', '1');
      const second = await addStudent('Second', '2');
      const res = await patchStudent(second.body.student.id, { rollNumber: '01' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Roll number 01 is already used in this class.');
      const row = await prisma.student.findUnique({ where: { id: second.body.student.id } });
      expect(row.rollNumber).toBe('2');
    });

    test('PATCH resending the same roll number succeeds, and changing it frees the old number', async () => {
      const first = await addStudent('First', '1');
      const renamed = await patchStudent(first.body.student.id, { name: 'Renamed', rollNumber: '1' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.student.name).toBe('Renamed');

      expect((await patchStudent(first.body.student.id, { rollNumber: '2' })).status).toBe(200);
      expect((await addStudent('Second', '1')).status).toBe(201);
    });

    test.each([
      ['DELETE', (id) => as(teacherAToken)(request(app).delete(`/api/classroom/students/${id}`))],
      ['PATCH active:false', (id) => patchStudent(id, { active: false })],
    ])('deactivating with %s frees the number, and restoring into it 409s', async (_label, deactivate) => {
      const first = await addStudent('First', '3');
      expect((await deactivate(first.body.student.id)).status).toBe(200);
      expect((await addStudent('Second', '3')).status).toBe(201);

      const restore = await patchStudent(first.body.student.id, { active: true });
      expect(restore.status).toBe(409);
      expect((await prisma.student.findUnique({ where: { id: first.body.student.id } })).active).toBe(false);
    });

    test('restoring a student whose number is still free reclaims it', async () => {
      const first = await addStudent('First', '4');
      await patchStudent(first.body.student.id, { active: false });
      expect((await patchStudent(first.body.student.id, { active: true })).status).toBe(200);
      expect((await addStudent('Second', '4')).status).toBe(409);
    });

    test('a pre-existing duplicate stays editable, but cannot move onto another taken number', async () => {
      await addStudent('Holder', '6');
      await addStudent('Other', '8');
      const legacy = await prisma.student.create({
        data: { classId, teacherId: fx.teacherA.id, name: 'Legacy', rollNumber: '6' },
      });

      const renamed = await patchStudent(legacy.id, { name: 'Legacy Renamed', rollNumber: '6' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.student.rollNumber).toBe('6');

      expect((await patchStudent(legacy.id, { rollNumber: '8' })).status).toBe(409);
      expect((await patchStudent(legacy.id, { rollNumber: '11' })).status).toBe(200);
    });

    test('sorts roll numbers with letters by their digits', async () => {
      await addStudent('None', undefined);
      await addStudent('B1', 'B1');
      await addStudent('A10', 'A10');
      await addStudent('Ten', '10');
      await addStudent('A2', 'A2');
      await addStudent('Two', '2');

      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/students`));
      expect(res.body.students.map((s) => s.name)).toEqual(['Two', 'Ten', 'A2', 'A10', 'B1', 'None']);
    });

    describe('a number still held by a legacy duplicate', () => {
      let holderId;
      let legacyId;

      // What the migration leaves behind: the earliest student holds the key and the later duplicate has none.
      function createLegacy(rollNumber, overrides = {}) {
        return prisma.student.create({
          data: { classId, teacherId: fx.teacherA.id, name: 'Legacy', rollNumber, ...overrides },
        });
      }

      beforeEach(async () => {
        holderId = (await addStudent('Holder', '6')).body.student.id;
        legacyId = (await createLegacy('6')).id;
      });

      test.each([
        ['DELETE', (id) => as(teacherAToken)(request(app).delete(`/api/classroom/students/${id}`))],
        ['PATCH active:false', (id) => patchStudent(id, { active: false })],
        ['moving to another number', (id) => patchStudent(id, { rollNumber: '7' })],
      ])('stays taken after the key holder leaves it by %s', async (_label, leave) => {
        expect((await leave(holderId)).status).toBe(200);

        const res = await addStudent('New', '6');
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('Roll number 6 is already used in this class.');
        expect((await addStudent('Variant', '06')).status).toBe(409);

        const other = await addStudent('Other', '9');
        expect((await patchStudent(other.body.student.id, { rollNumber: '6' })).status).toBe(409);
      });

      test('blocks restoring the key holder while the legacy row is active', async () => {
        await patchStudent(holderId, { active: false });
        expect((await patchStudent(holderId, { active: true })).status).toBe(409);
        expect((await prisma.student.findUnique({ where: { id: holderId } })).active).toBe(false);
      });

      test.each([
        ['moves to another number', () => patchStudent(legacyId, { rollNumber: '11' })],
        ['is deactivated', () => patchStudent(legacyId, { active: false })],
      ])('is free again once the holder has left and the legacy row %s', async (_label, release) => {
        await patchStudent(holderId, { active: false });
        expect((await release()).status).toBe(200);
        expect((await addStudent('New', '6')).status).toBe(201);
      });

      test('the legacy row itself stays editable after the holder leaves', async () => {
        await patchStudent(holderId, { active: false });
        const res = await patchStudent(legacyId, { name: 'Legacy Renamed', rollNumber: '6' });
        expect(res.status).toBe(200);
      });

      test('an inactive legacy row does not hold a number', async () => {
        await createLegacy('12', { active: false });
        expect((await addStudent('New', '12')).status).toBe(201);
      });

      test('a legacy row in another class does not hold a number here', async () => {
        await createLegacy('13', { classId: otherClassId });
        expect((await addStudent('New', '13')).status).toBe(201);
      });

      test('another teacher gets a 404, never a 409', async () => {
        await patchStudent(holderId, { active: false });
        const other = await addStudent('Other', '9');

        const post = await as(teacherA2Token)(
          request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Intruder', rollNumber: '6' })
        );
        expect(post.status).toBe(404);
        expect((await patchStudent(other.body.student.id, { rollNumber: '6' }, teacherA2Token)).status).toBe(404);
      });
    });

    test('rollNumberKey is neither accepted from a client nor returned to one', async () => {
      const created = await addStudent('First', '1');
      expect(created.body.student).not.toHaveProperty('rollNumberKey');

      const post = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Second', rollNumberKey: 'x' })
      );
      expect(post.status).toBe(400);
      expect((await patchStudent(created.body.student.id, { rollNumberKey: 'x' })).status).toBe(400);
    });

    test('a taken roll number never tells another teacher the class or student exists', async () => {
      await addStudent('First', '1');
      const second = await addStudent('Second', '2');

      const post = await as(teacherA2Token)(
        request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Intruder', rollNumber: '1' })
      );
      expect(post.status).toBe(404);
      expect((await patchStudent(second.body.student.id, { rollNumber: '1' }, teacherA2Token)).status).toBe(404);
    });

    test('requires authentication', async () => {
      const res = await request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Anon', rollNumber: '1' });
      expect(res.status).toBe(401);
    });
  });
});
