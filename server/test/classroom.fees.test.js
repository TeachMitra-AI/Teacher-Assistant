// Classroom Management — fees, extended for real amounts
// (docs/fee-tracking-amounts-plan.md). The client sends `amount` (rupees
// paid so far); `status` (paid/partial/pending) is always derived
// server-side from amount vs the class's feeAmount, never accepted from
// the client.
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
      expect(s1Row.amount).toBe(0);
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

  describe('PATCH /api/classroom/students/:studentId/fees/:period — no class feeAmount set', () => {
    test('any amount > 0 derives status "paid" (binary fallback with no feeAmount)', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-06`).send({ amount: 500 })
      );
      expect(res.status).toBe(200);
      expect(res.body.fee.status).toBe('paid');
      expect(res.body.fee.amount).toBe(500);
      const row = await prisma.feeRecord.findUnique({ where: { studentId_period: { studentId: s1, period: '2026-06' } } });
      expect(row.status).toBe('paid');
      expect(row.amount).toBe(500);
      expect(row.paidAt).not.toBeNull();
    });

    test('re-setting the same student/period upserts — no duplicate row', async () => {
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s1}/fees/2026-07`).send({ amount: 300 }));
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s1}/fees/2026-07`).send({ amount: 0 }));
      const count = await prisma.feeRecord.count({ where: { studentId: s1, period: '2026-07' } });
      expect(count).toBe(1);
      const row = await prisma.feeRecord.findFirst({ where: { studentId: s1, period: '2026-07' } });
      expect(row.status).toBe('pending');
      expect(row.amount).toBe(0);
      expect(row.paidAt).toBeNull();
    });

    // Status is derived, not settable — this pins that as an enforced
    // contract: the client can no longer flip a status directly.
    test('rejects a client-supplied status — the server derives it', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ status: 'paid' })
      );
      expect(res.status).toBe(400);
    });

    test('rejects a negative or non-integer amount', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ amount: -5 })
      );
      expect(res.status).toBe(400);

      const res2 = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-08`).send({ amount: 4.5 })
      );
      expect(res2.status).toBe(400);
    });

    test('rejects a malformed period', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/aug-2026`).send({ amount: 100 })
      );
      expect(res.status).toBe(400);
    });

    test('404s for a student owned by someone else', async () => {
      const res = await as(teacherBToken)(
        request(app).patch(`/api/classroom/students/${s1}/fees/2026-06`).send({ amount: 100 })
      );
      expect(res.status).toBe(404);
    });

    test('the DTO includes amount and expectedAmount', async () => {
      const res = await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s2}/fees/2026-06`).send({ amount: 200 }));
      expect(res.body.fee.amount).toBe(200);
      expect(res.body.fee.expectedAmount).toBeNull(); // class never set a feeAmount
    });
  });

  describe('PATCH — class WITH a feeAmount set', () => {
    let classWithFeeId;
    let student;

    beforeAll(async () => {
      const cls = await as(teacherAToken)(
        request(app).post('/api/classroom/classes').send({ name: 'Priced Class', feeAmount: 500 })
      );
      classWithFeeId = cls.body.class.id;
      const st = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classWithFeeId}/students`).send({ name: 'Imran' }));
      student = st.body.student.id;
    });

    test('amount below feeAmount derives "partial"', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${student}/fees/2026-06`).send({ amount: 300 })
      );
      expect(res.status).toBe(200);
      expect(res.body.fee.status).toBe('partial');
      expect(res.body.fee.expectedAmount).toBe(500);
    });

    test('amount meeting feeAmount derives "paid"', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${student}/fees/2026-07`).send({ amount: 500 })
      );
      expect(res.status).toBe(200);
      expect(res.body.fee.status).toBe('paid');
    });

    test('changing the class feeAmount later does not change an already-recorded period\'s expectedAmount', async () => {
      await as(teacherAToken)(request(app).patch(`/api/classroom/classes/${classWithFeeId}`).send({ feeAmount: 800 }));
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classWithFeeId}/fees?period=2026-06`));
      const row = res.body.perStudent.find((s) => s.studentId === student);
      expect(row.expectedAmount).toBe(500); // snapshot from when the record was created, not the new 800
      expect(row.status).toBe('partial'); // 300 / 500
    });

    test('a not-yet-touched period picks up the NEW feeAmount', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classWithFeeId}/fees?period=2026-09`));
      const row = res.body.perStudent.find((s) => s.studentId === student);
      expect(row.expectedAmount).toBe(800);
      expect(row.status).toBe('pending');
    });
  });

  describe('deactivated students', () => {
    test('a deactivated student drops out of the fee status list, but their FeeRecord history is preserved (not hard-deleted)', async () => {
      const st = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${classId}/students`).send({ name: 'Hema' }));
      const studentId = st.body.student.id;
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${studentId}/fees/2026-09`).send({ amount: 500 }));

      await as(teacherAToken)(request(app).delete(`/api/classroom/students/${studentId}`));

      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees?period=2026-09`));
      expect(res.status).toBe(200);
      expect(res.body.perStudent.find((s) => s.studentId === studentId)).toBeUndefined();

      const row = await prisma.feeRecord.findUnique({ where: { studentId_period: { studentId, period: '2026-09' } } });
      expect(row).not.toBeNull();
      expect(row.status).toBe('paid');
    });
  });

  describe('pending-fees reminder notification (docs/fee-tracking-amounts-plan.md Step 3)', () => {
    let savedNotifEnv;
    let remindClassId;
    let remindStudentA;
    let remindStudentB;

    beforeAll(async () => {
      savedNotifEnv = process.env.NOTIFICATIONS_ENABLED;
      process.env.NOTIFICATIONS_ENABLED = 'true';

      const cls = await as(teacherAToken)(
        request(app).post('/api/classroom/classes').send({ name: 'Reminder Class', feeAmount: 500 })
      );
      remindClassId = cls.body.class.id;
      const stA = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${remindClassId}/students`).send({ name: 'Kavya' }));
      remindStudentA = stA.body.student.id;
      const stB = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${remindClassId}/students`).send({ name: 'Lokesh' }));
      remindStudentB = stB.body.student.id;
    });

    afterAll(() => {
      if (savedNotifEnv === undefined) delete process.env.NOTIFICATIONS_ENABLED;
      else process.env.NOTIFICATIONS_ENABLED = savedNotifEnv;
    });

    test('recording a partial payment (someone still owing) creates exactly one reminder notification', async () => {
      const res = await as(teacherAToken)(
        request(app).patch(`/api/classroom/students/${remindStudentA}/fees/2026-06`).send({ amount: 200 })
      );
      expect(res.status).toBe(200);

      const link = `/classroom?tab=reports&class=${remindClassId}&period=2026-06`;
      const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id, type: 'reminder', link } });
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toMatch(/2 students? still owe fees/);
    });

    test('a second payment for the same class+period does not send a duplicate reminder', async () => {
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${remindStudentB}/fees/2026-06`).send({ amount: 100 }));

      const link = `/classroom?tab=reports&class=${remindClassId}&period=2026-06`;
      const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id, type: 'reminder', link } });
      expect(rows).toHaveLength(1); // still just the one from the previous test
    });

    test('no reminder is created once nobody owes money any more', async () => {
      const cls2 = await as(teacherAToken)(
        request(app).post('/api/classroom/classes').send({ name: 'Fully Paid Class', feeAmount: 500 })
      );
      const st = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${cls2.body.class.id}/students`).send({ name: 'Meena' }));
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${st.body.student.id}/fees/2026-07`).send({ amount: 500 }));

      const link = `/classroom?tab=reports&class=${cls2.body.class.id}&period=2026-07`;
      const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id, type: 'reminder', link } });
      expect(rows).toHaveLength(0);
    });

    test('no reminder is created while NOTIFICATIONS_ENABLED is off', async () => {
      process.env.NOTIFICATIONS_ENABLED = 'false';
      try {
        const cls3 = await as(teacherAToken)(
          request(app).post('/api/classroom/classes').send({ name: 'Flag Off Class', feeAmount: 500 })
        );
        const st = await as(teacherAToken)(request(app).post(`/api/classroom/classes/${cls3.body.class.id}/students`).send({ name: 'Nitin' }));
        await as(teacherAToken)(request(app).patch(`/api/classroom/students/${st.body.student.id}/fees/2026-08`).send({ amount: 0 }));

        const link = `/classroom?tab=reports&class=${cls3.body.class.id}&period=2026-08`;
        const rows = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id, type: 'reminder', link } });
        expect(rows).toHaveLength(0);
      } finally {
        process.env.NOTIFICATIONS_ENABLED = 'true';
      }
    });
  });
});
