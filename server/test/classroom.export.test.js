// Classroom Management — CSV report export (docs/classroom-feature-plan.md
// §13). Attendance export's percentage-formula consistency is pinned
// separately in classroom.attendance.test.js; this file covers the export
// mechanics themselves: headers/rows/escaping, required class+month
// filtering, Content-Type/Content-Disposition, and ownership (404, never a
// way to probe another teacher's data).
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const ENV_KEYS = ['CLASSROOM_MANAGEMENT_ENABLED'];
function enableClassroom() {
  process.env.CLASSROOM_MANAGEMENT_ENABLED = 'true';
}

function parseCsv(text) {
  // Good enough for these fixtures: only one field ever contains a comma
  // (the escaping test), handled with a small quoted-field-aware split.
  const lines = text.trim().split('\r\n');
  return lines.map((line) => {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  });
}

describe('Classroom Management — CSV export', () => {
  let fx;
  let teacherAToken;
  let teacherBToken;
  let savedEnv;
  let classId;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'clsexp');
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

  async function addStudent(token, cId, name, rollNumber) {
    const res = await as(token)(request(app).post(`/api/classroom/classes/${cId}/students`).send({ name, rollNumber }));
    return res.body.student.id;
  }

  beforeAll(async () => {
    classId = await makeClass(teacherAToken, 'Export Test Class');
  });

  describe('attendance export', () => {
    test('requires class + month — no unscoped export', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export`));
      expect(res.status).toBe(400);
    });

    test('returns CSV with correct Content-Type and a downloadable filename', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-09`));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['content-disposition']).toMatch(/attendance\.csv/);
    });

    test('header row matches the documented columns', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-09`));
      const rows = parseCsv(res.text);
      expect(rows[0]).toEqual(['Student Name', 'Roll Number', 'Present', 'Absent', 'Unmarked', 'Attendance %']);
    });

    test('escapes a student name containing a comma and a quote', async () => {
      const tricky = await addStudent(teacherAToken, classId, 'Doe, "Jane"', '99');
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-09`));
      const rows = parseCsv(res.text);
      const row = rows.find((r) => r[1] === '99');
      expect(row[0]).toBe('Doe, "Jane"'); // survives the round trip once properly unescaped
      await prisma.student.update({ where: { id: tricky }, data: { active: false } }); // cleanup for later tests
    });

    test('404s for a class owned by someone else', async () => {
      const res = await as(teacherBToken)(request(app).get(`/api/classroom/classes/${classId}/attendance/export?month=2026-09`));
      expect(res.status).toBe(404);
    });
  });

  describe('fee export', () => {
    let s1;
    let s2;

    beforeAll(async () => {
      s1 = await addStudent(teacherAToken, classId, 'Hema', '10');
      s2 = await addStudent(teacherAToken, classId, 'Irfan', '11');
      await as(teacherAToken)(request(app).patch(`/api/classroom/students/${s1}/fees/2026-09`).send({ status: 'paid' }));
      // s2 left as default pending — no explicit PATCH.
    });

    test('requires class + period — no unscoped export', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees/export`));
      expect(res.status).toBe(400);
    });

    test('returns CSV with correct Content-Type, filename, header, and rows', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees/export?period=2026-09`));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/fees\.csv/);

      const rows = parseCsv(res.text);
      expect(rows[0]).toEqual(['Student Name', 'Roll Number', 'Status']);
      const hemaRow = rows.find((r) => r[1] === '10');
      const irfanRow = rows.find((r) => r[1] === '11');
      expect(hemaRow[2]).toBe('Paid');
      expect(irfanRow[2]).toBe('Pending'); // never marked — still defaults to Pending
    });

    test('never includes amount/paidAt/note columns — matches the V1 UI scope', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/classroom/classes/${classId}/fees/export?period=2026-09`));
      const rows = parseCsv(res.text);
      expect(rows[0]).toHaveLength(3);
      for (const row of rows) expect(row).toHaveLength(3);
    });

    test('404s for a class owned by someone else', async () => {
      const res = await as(teacherBToken)(request(app).get(`/api/classroom/classes/${classId}/fees/export?period=2026-09`));
      expect(res.status).toBe(404);
    });
  });
});
