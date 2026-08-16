// Classroom Management — attendance (docs/classroom-feature-plan.md §10).
// Mirrors classroom.test.js's shape: flag manipulation via process.env,
// fixtures from helpers/fixtures, loginAs for real HTTP-path tokens.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const ENV_KEYS = ['CLASSROOM_MANAGEMENT_ENABLED'];
function enableClassroom() {
  process.env.CLASSROOM_MANAGEMENT_ENABLED = 'true';
}

/** Splits a small, unquoted CSV body (test data never contains commas/quotes) into rows of fields. */
function parseCsv(text) {
  return text
    .trim()
    .split('\r\n')
    .map((line) => line.split(','));
}

describe('Classroom Management — attendance', () => {
  let fx;
  let teacherAToken;
  let teacherBToken;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'clsatt');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, fx.PASSWORD);
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

  async function makeClass(token, name) {
    const res = await as(token)(request(app).post('/api/classroom/classes').send({ name }));
    return res.body.class.id;
  }

  async function addStudent(token, classId, name, rollNumber) {
    const res = await as(token)(
      request(app).post(`/api/classroom/classes/${classId}/students`).send({ name, rollNumber })
    );
    return res.body.student.id;
  }

  describe('POST /api/classroom/classes/:classId/attendance (bulk mark)', () => {
    let classId;
    let s1;
    let s2;
    let s3;

    beforeAll(async () => {
      classId = await makeClass(teacherAToken, 'Mark Test');
      s1 = await addStudent(teacherAToken, classId, 'Asha');
      s2 = await addStudent(teacherAToken, classId, 'Bala');
      s3 = await addStudent(teacherAToken, classId, 'Chetan');
    });

    test('marks present/absent and the day view reflects it, unmarked students included', async () => {
      const res = await as(teacherAToken)(
        request(app)
          .post(`/api/classroom/classes/${classId}/attendance`)
          .send({ date: '2026-02-03', marks: [{ studentId: s1, status: 'present' }, { studentId: s2, status: 'absent' }] })
      );
      expect(res.status).toBe(200);
      expect(res.body.saved).toBe(2);

      const day = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance?date=2026-02-03`));
      expect(day.status).toBe(200);
      const byId = Object.fromEntries(day.body.roster.map((r) => [r.studentId, r.status]));
      expect(byId[s1]).toBe('present');
      expect(byId[s2]).toBe('absent');
      expect(byId[s3]).toBe('unmarked'); // never touched — still unmarked, not silently present or absent
      expect(day.body.summary).toEqual({ present: 1, absent: 1, unmarked: 1, percentage: 50 });
    });

    test('re-marking the same date/student upserts — no duplicate row', async () => {
      await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-04', marks: [{ studentId: s1, status: 'present' }] })
      );
      const before = await prisma.attendanceRecord.count({ where: { studentId: s1, date: new Date('2026-02-04T00:00:00.000Z') } });
      expect(before).toBe(1);

      await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-04', marks: [{ studentId: s1, status: 'absent' }] })
      );
      const after = await prisma.attendanceRecord.count({ where: { studentId: s1, date: new Date('2026-02-04T00:00:00.000Z') } });
      expect(after).toBe(1); // still exactly one row
      const row = await prisma.attendanceRecord.findFirst({ where: { studentId: s1, date: new Date('2026-02-04T00:00:00.000Z') } });
      expect(row.status).toBe('absent'); // the correction won
    });

    test('sending status "unmarked" deletes the row — moving a student back to unmarked', async () => {
      await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-05', marks: [{ studentId: s1, status: 'present' }] })
      );
      expect(await prisma.attendanceRecord.count({ where: { studentId: s1, date: new Date('2026-02-05T00:00:00.000Z') } })).toBe(1);

      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-05', marks: [{ studentId: s1, status: 'unmarked' }] })
      );
      expect(res.status).toBe(200);
      expect(await prisma.attendanceRecord.count({ where: { studentId: s1, date: new Date('2026-02-05T00:00:00.000Z') } })).toBe(0);
    });

    test('unmarking a student who was never marked is a harmless no-op', async () => {
      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-06', marks: [{ studentId: s2, status: 'unmarked' }] })
      );
      expect(res.status).toBe(200);
    });

    test('rejects the WHOLE batch if any student does not belong to this class — no partial save', async () => {
      const otherClassId = await makeClass(teacherAToken, 'Other Class');
      const outsider = await addStudent(teacherAToken, otherClassId, 'Outsider');

      const before = await prisma.attendanceRecord.count({ where: { classId } });
      const res = await as(teacherAToken)(
        request(app)
          .post(`/api/classroom/classes/${classId}/attendance`)
          .send({ date: '2026-02-07', marks: [{ studentId: s1, status: 'present' }, { studentId: outsider, status: 'present' }] })
      );
      expect(res.status).toBe(400);
      expect(await prisma.attendanceRecord.count({ where: { classId } })).toBe(before); // nothing partially saved
    });

    test('rejects a studentId belonging to another teacher entirely', async () => {
      const bClassId = await makeClass(teacherBToken, 'Teacher B Class');
      const bStudent = await addStudent(teacherBToken, bClassId, 'Teacher B Student');

      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-08', marks: [{ studentId: bStudent, status: 'present' }] })
      );
      expect(res.status).toBe(400);
    });

    test('validation: rejects a malformed date, an empty marks array, and an unknown status', async () => {
      const badDate = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '03-02-2026', marks: [{ studentId: s1, status: 'present' }] })
      );
      expect(badDate.status).toBe(400);

      const emptyMarks = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-09', marks: [] })
      );
      expect(emptyMarks.status).toBe(400);

      const badStatus = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-09', marks: [{ studentId: s1, status: 'late' }] })
      );
      expect(badStatus.status).toBe(400);
    });

    test('404s for a class owned by someone else', async () => {
      const res = await as(teacherBToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-02-10', marks: [{ studentId: s1, status: 'present' }] })
      );
      expect(res.status).toBe(404);
    });
  });

  // The exact worked example from the approved plan: 30 students, 25 present,
  // 3 absent, 2 unmarked → 89.3%, NOT 25/30 = 83.3%. Pinned against BOTH the
  // summary endpoint and the exported CSV, so a future edit can never
  // silently fold unmarked back into the denominator without breaking this
  // test.
  describe('attendance percentage formula — present / (present + absent) * 100, unmarked excluded', () => {
    let classId;
    let studentIds;

    beforeAll(async () => {
      classId = await makeClass(teacherAToken, 'Percentage Formula Test');
      studentIds = [];
      for (let i = 1; i <= 30; i++) {
        studentIds.push(await addStudent(teacherAToken, classId, `Student ${String(i).padStart(2, '0')}`, String(i)));
      }

      const marks = [
        ...studentIds.slice(0, 25).map((studentId) => ({ studentId, status: 'present' })),
        ...studentIds.slice(25, 28).map((studentId) => ({ studentId, status: 'absent' })),
        // studentIds[28] and studentIds[29] are deliberately never marked — unmarked.
      ];
      const res = await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-03-10', marks })
      );
      expect(res.status).toBe(200);
    });

    test('GET attendance/summary?month= returns 25/3/2 and 89.3%, not 83.3%', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/summary?month=2026-03`));
      expect(res.status).toBe(200);
      expect(res.body.present).toBe(25);
      expect(res.body.absent).toBe(3);
      expect(res.body.unmarked).toBe(2);
      expect(res.body.totalStudents).toBe(30);
      expect(res.body.percentage).toBe(89.3);
      expect(res.body.percentage).not.toBe(83.3);
    });

    test('the exported CSV TOTAL row matches the summary endpoint exactly', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-03`));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);

      const rows = parseCsv(res.text);
      const totalRow = rows.find((r) => r[0] === 'TOTAL');
      expect(totalRow).toBeDefined();
      const [, , present, absent, unmarked, percentage] = totalRow;
      expect(present).toBe('25');
      expect(absent).toBe('3');
      expect(unmarked).toBe('2');
      expect(percentage).toBe('89.3');
    });

    test('day-marking summary (single day) also uses the same formula', async () => {
      const day = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance?date=2026-03-10`));
      expect(day.status).toBe(200);
      expect(day.body.summary).toEqual({ present: 25, absent: 3, unmarked: 2, percentage: 89.3 });
    });
  });

  describe('GET /api/classroom/classes/:classId/attendance/history', () => {
    let classId;
    let s1;
    let s2;

    beforeAll(async () => {
      classId = await makeClass(teacherAToken, 'History Test');
      s1 = await addStudent(teacherAToken, classId, 'Deepa');
      s2 = await addStudent(teacherAToken, classId, 'Esha');
      await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-04-01', marks: [{ studentId: s1, status: 'present' }, { studentId: s2, status: 'present' }] })
      );
      await as(teacherAToken)(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-04-02', marks: [{ studentId: s1, status: 'absent' }] })
      );
    });

    test('returns one row per day that has at least one mark, with per-day three-way counts', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/history?month=2026-04`));
      expect(res.status).toBe(200);
      const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d]));
      expect(byDate['2026-04-01']).toEqual({ date: '2026-04-01', present: 2, absent: 0, unmarked: 0, percentage: 100 });
      expect(byDate['2026-04-02']).toEqual({ date: '2026-04-02', present: 0, absent: 1, unmarked: 1, percentage: 0 });
      expect(res.body.days.length).toBe(2); // no all-zero row for days nobody marked
    });

    test('requires a valid month param', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/history`));
      expect(res.status).toBe(400);
    });
  });
});
