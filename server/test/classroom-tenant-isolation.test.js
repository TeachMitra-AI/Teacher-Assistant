// Classroom Management — tenant isolation (docs/classroom-feature-plan.md
// §8, §15). Same shape as test/tenant-isolation.test.js: assert one
// teacher's classroom data (classes/students/attendance/fees, including
// export) can NEVER be read or written by another teacher, even via a
// guessed/enumerated id — and, the case specific to this feature's V1 scope,
// that NO role gets special cross-teacher visibility, not even
// school_admin/resource_person/super_admin. Classroom isolation is per
// TEACHER (req.user.id), not per school — this file proves that
// specifically, which is why it is a separate file from the general
// tenant-isolation.test.js (which is about school boundaries).
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const ENV_KEYS = ['CLASSROOM_MANAGEMENT_ENABLED'];
function enableClassroom() {
  process.env.CLASSROOM_MANAGEMENT_ENABLED = 'true';
}

describe('Classroom Management — tenant isolation', () => {
  let fx;
  let teacherAToken;
  let teacherA2Token; // same school as teacherA — proves isolation is per-teacher, not per-school
  let schoolAdminAToken;
  let resourcePersonAToken;
  let superAdminToken;
  let savedEnv;

  let classId;
  let studentId;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'clsiso');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherA2Token = await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD);
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, fx.PASSWORD);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, fx.PASSWORD);
    superAdminToken = await loginAs(app, fx.schoolA, fx.superAdmin, fx.PASSWORD);
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    enableClassroom();

    function as(token) {
      return (req) => req.set('Authorization', `Bearer ${token}`);
    }
    const cls = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Isolation Test Class' }));
    classId = cls.body.class.id;
    const student = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Private Student' }));
    studentId = student.body.student.id;
    await as(teacherAToken)(
      request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-10-01', marks: [{ studentId, status: 'present' }] })
    );
    await as(teacherAToken)(request(app).patch(`/api/classroom/students/${studentId}/fees/2026-10`).send({ status: 'paid' }));
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

  // Every non-owner role that should be blocked from teacherA's data,
  // including a SECOND TEACHER AT THE SAME SCHOOL — the case that proves
  // isolation is per-teacher, not per-school.
  const NON_OWNER_ROLES = [
    ['a second teacher at the SAME school', () => teacherA2Token],
    ['school_admin (same school)', () => schoolAdminAToken],
    ['resource_person (same school)', () => resourcePersonAToken],
    ['super_admin', () => superAdminToken],
  ];

  describe.each(NON_OWNER_ROLES)('%s can never read or write teacher A\'s classroom data', (_label, getToken) => {
    test('cannot GET the class', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}`));
      expect(res.status).toBe(404);
    });

    test('the class does not appear in their own class list', async () => {
      const res = await as(getToken())(request(app).get('/api/classroom/classes?includeArchived=true'));
      expect(res.status).toBe(200);
      expect(res.body.classes.map((c) => c.id)).not.toContain(classId);
    });

    test('cannot PATCH (rename) the class', async () => {
      const res = await as(getToken())(request(app).patch(`/api/classroom/classes/${classId}`).send({ name: 'Hijacked' }));
      expect(res.status).toBe(404);
    });

    test('cannot DELETE (archive) the class', async () => {
      const res = await as(getToken())(request(app).delete(`/api/classroom/classes/${classId}`));
      expect(res.status).toBe(404);
      const stillActive = await prisma.schoolClass.findUnique({ where: { id: classId } });
      expect(stillActive.archived).toBe(false);
    });

    test('cannot list the roster', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/students`));
      expect(res.status).toBe(404);
    });

    test('cannot add a student to the class', async () => {
      const res = await as(getToken())(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Intruder' }));
      expect(res.status).toBe(404);
    });

    test('cannot PATCH the student directly by guessed id', async () => {
      const res = await as(getToken())(request(app).patch(`/api/classroom/students/${studentId}`).send({ name: 'Hijacked' }));
      expect(res.status).toBe(404);
    });

    test('cannot DELETE the student', async () => {
      const res = await as(getToken())(request(app).delete(`/api/classroom/students/${studentId}`));
      expect(res.status).toBe(404);
    });

    test('cannot read the day\'s attendance', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/attendance?date=2026-10-01`));
      expect(res.status).toBe(404);
    });

    test('cannot mark attendance on the class', async () => {
      const res = await as(getToken())(
        request(app).post(`/api/classroom/classes/${classId}/attendance`).send({ date: '2026-10-02', marks: [{ studentId, status: 'absent' }] })
      );
      expect(res.status).toBe(404);
      const row = await prisma.attendanceRecord.findUnique({ where: { studentId_date: { studentId, date: new Date('2026-10-02T00:00:00.000Z') } } });
      expect(row).toBeNull();
    });

    test('cannot read the attendance summary/history', async () => {
      const summary = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/attendance/summary?month=2026-10`));
      expect(summary.status).toBe(404);
      const history = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/attendance/history?month=2026-10`));
      expect(history.status).toBe(404);
    });

    test('cannot read the student-level attendance history', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/students/${studentId}/attendance/history?month=2026-10`));
      expect(res.status).toBe(404);
    });

    test('cannot download the attendance or fee CSV export', async () => {
      const attendance = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-10`));
      expect(attendance.status).toBe(404);
      const fees = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/fees/export?period=2026-10`));
      expect(fees.status).toBe(404);
    });

    test('cannot read the fee status', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-10`));
      expect(res.status).toBe(404);
    });

    test('cannot change the fee status', async () => {
      const res = await as(getToken())(request(app).patch(`/api/classroom/students/${studentId}/fees/2026-10`).send({ status: 'pending' }));
      expect(res.status).toBe(404);
      const row = await prisma.feeRecord.findUnique({ where: { studentId_period: { studentId, period: '2026-10' } } });
      expect(row.status).toBe('paid'); // untouched
    });

    test('their own analytics never surfaces teacher A\'s totals', async () => {
      const res = await as(getToken())(request(app).get('/api/classroom/analytics/overview'));
      expect(res.status).toBe(200);
      // Any of these roles has zero classroom data of their own in this
      // fixture, so their overview must show zero students, not teacher A's.
      expect(res.body.totalStudents).toBe(0);
    });

    test('cannot reach teacher A\'s per-class analytics', async () => {
      const res = await as(getToken())(request(app).get(`/api/classroom/analytics/classes/${classId}`));
      expect(res.status).toBe(404);
    });
  });

  test('the owning teacher can still read everything after all the above attempts', async () => {
    const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}`));
    expect(res.status).toBe(200);
    expect(res.body.class.name).toBe('Isolation Test Class');
    const fee = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-10`));
    expect(fee.body.perStudent.find((s) => s.studentId === studentId).status).toBe('paid');
  });
});
