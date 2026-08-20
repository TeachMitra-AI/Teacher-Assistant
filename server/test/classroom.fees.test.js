// Classroom Management — fees (docs/classroom-feature-plan.md §11).
// V1 is deliberately Paid/Pending only — this file pins that as an enforced
// API contract, not just a UI choice.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const ENV_KEYS = ['CLASSROOM_MANAGEMENT_ENABLED'];
function enableClassroom() {
  process.env.CLASSROOM_MANAGEMENT_ENABLED = 'true';
}

describe('Classroom Management — fees', () => {
  let fx;
  let teacherAToken;
  let teacherBToken;
  let savedEnv;
  let classId;
  let s1;
  let s2;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'clsfee');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, fx.PASSWORD);
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    enableClassroom();

    function as(token) {
      return (req) => req.set('Authorization', `Bearer ${token}`);
    }
    const cls = await as(teacherAToken)(request(app).post('/api/classroom/classes').send({ name: 'Fee Test Class' }));
    classId = cls.body.class.id;
    const st1 = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Farah' }));
    s1 = st1.body.student.id;
    const st2 = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Gopal' }));
    s2 = st2.body.student.id;
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

  describe('GET /api/classroom/classes/:classId/fees', () => {
    test('a student with no FeeRecord yet reads as "pending" — no row created just by reading', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-05`));
      expect(res.status).toBe(200);
      const s1Row = res.body.perStudent.find((s) => s.studentId === s1);
      expect(s1Row.status).toBe('pending');
      expect(res.body.paid).toBe(0);
      expect(res.body.pending).toBe(2);
      expect(await prisma.feeRecord.count({ where: { studentId: s1, period: '2026-05' } })).toBe(0);
    });

    test('requires a valid period param', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees`));
      expect(res.status).toBe(400);
    });

    test('404s for a class owned by someone else', async () => {
      const res = await as(teacherBToken)(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-05`));
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/classroom/students/:studentId/fees/:period', () => {
    test('sets status to paid, upserting a new FeeRecord', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-06`).send({ status: 'paid' })
      );
      expect(res.status).toBe(200);
      expect(res.body.fee.status).toBe('paid');
      const row = await prisma.feeRecord.findUnique({ where: { studentId_period: { studentId: s1, period: '2026-06' } } });
      expect(row.status).toBe('paid');
    });

    test('re-setting the same student/period upserts — no duplicate row', async () => {
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s1}/fees/2026-07`).send({ status: 'paid' }));
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s1}/fees/2026-07`).send({ status: 'pending' }));
      const count = await prisma.feeRecord.count({ where: { studentId: s1, period: '2026-07' } });
      expect(count).toBe(1);
      const row = await prisma.feeRecord.findFirst({ where: { studentId: s1, period: '2026-07' } });
      expect(row.status).toBe('pending');
    });

    // Pins "V1 UI/API surface is Paid/Pending only" as a contract: the schema
    // reserves amount/paidAt/note (§11/§19) for later, but no V1 route may
    // accept them from the client.
    test('rejects amount/paidAt/note — V1 exposes status only', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ status: 'paid', amount: 500 })
      );
      expect(res.status).toBe(400);

      const res2 = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ status: 'paid', note: 'cash' })
      );
      expect(res2.status).toBe(400);

      const res3 = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ status: 'paid', paidAt: '2026-08-01T00:00:00.000Z' })
      );
      expect(res3.status).toBe(400);
    });

    test('rejects a status outside the closed vocabulary', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ status: 'partial' })
      );
      expect(res.status).toBe(400);
    });

    test('rejects a malformed period', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/aug-2026`).send({ status: 'paid' })
      );
      expect(res.status).toBe(400);
    });

    test('404s for a student owned by someone else', async () => {
      const res = await as(teacherBToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-06`).send({ status: 'paid' })
      );
      expect(res.status).toBe(404);
    });

    test('the DTO never includes amount/paidAt/note', async () => {
      const res = await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s2}/fees/2026-06`).send({ status: 'paid' }));
      expect(res.body.fee.amount).toBeUndefined();
      expect(res.body.fee.paidAt).toBeUndefined();
      expect(res.body.fee.note).toBeUndefined();
    });
  });

  describe('deactivated students', () => {
    test('a deactivated student drops out of the fee status list, but their FeeRecord history is preserved (not hard-deleted)', async () => {
      const st = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Hema' }));
      const studentId = st.body.student.id;
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${studentId}/fees/2026-09`).send({ status: 'paid' }));

      await as(teacherAToken)(request(app).delete(`/api/classroom/students/${studentId}`));

      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-09`));
      expect(res.status).toBe(200);
      expect(res.body.perStudent.find((s) => s.studentId === studentId)).toBeUndefined();

      const row = await prisma.feeRecord.findUnique({ where: { studentId_period: { studentId, period: '2026-09' } } });
      expect(row).not.toBeNull();
      expect(row.status).toBe('paid');
    });
  });
});
