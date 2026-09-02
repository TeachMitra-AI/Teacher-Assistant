// Teacher Attendance — routes/teacherAttendance.js.
// Mirrors classroom.attendance.test.js's shape: flag manipulation via
// process.env, fixtures from helpers/fixtures, loginAs for real HTTP-path
// tokens. System time is controlled with vi.setSystemTime() so arrival
// classification (on time / late / outside window) and working-time math
// are deterministic regardless of when this suite actually runs — the
// route always reads `new Date()` for the server's own clock (never trusts
// a client-sent time), so that's the clock this suite has to control.
//
// This file was rewritten for the redesigned plan
// (docs/feature-teacher-attendance-implementation-plan.md) — geofence and
// check-in/out-window failures are now hard blocks with no attendance row
// and no Principal review queue (removed entirely), not an allowed-but-
// flagged record. Corrections are still testable directly via
// POST /:id/review, just no longer reachable only through a queue.
const request = require('supertest');
const ExcelJS = require('exceljs');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { istDateString } = require('../src/lib/teacherAttendance');

// supertest/superagent only auto-buffers a handful of built-in content
// types into `res.body` — an .xlsx response's MIME type isn't one of them,
// so without this it gets silently mis-decoded as text. Same helper as
// test/classroom.export.test.js.
function binaryParser(res, callback) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => callback(null, Buffer.from(data, 'binary')));
}

const ENV_KEYS = ['TEACHER_ATTENDANCE_ENABLED'];
function enableTeacherAttendance() {
  process.env.TEACHER_ATTENDANCE_ENABLED = 'true';
}

const CONFIG = {
  openTime: '09:00',
  closeTime: '16:00',
  checkinWindowStart: '08:30',
  checkinWindowEnd: '10:00',
  geofenceLat: 12.9716,
  geofenceLon: 77.5946,
  geofenceRadiusMeters: 180,
};

const FAR_AWAY = { lat: 13.0827, lon: 80.2707 }; // Chennai — hundreds of km away

// Builds a UTC Date whose IST wall-clock time is hh:mm on the given
// "YYYY-MM-DD" IST calendar date.
function istDateTime(dateStr, hours, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const istMinutesOfDay = hours * 60 + minutes;
  const utcMinutesOfDay = (istMinutesOfDay - (5 * 60 + 30) + 1440) % 1440;
  const dayRollback = istMinutesOfDay - (5 * 60 + 30) < 0 ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d - dayRollback, Math.floor(utcMinutesOfDay / 60), utcMinutesOfDay % 60));
}

describe('Teacher Attendance', () => {
  let fx;
  let teacherAToken;
  let teacherA2Token;
  let teacherBToken;
  let adminAToken;
  let adminBToken;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'tchatt');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    teacherA2Token = await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD);
    teacherBToken = await loginAs(app, fx.schoolB, fx.teacherB, fx.PASSWORD);
    adminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, fx.PASSWORD);
    adminBToken = await loginAs(app, fx.schoolB, fx.schoolAdminB, fx.PASSWORD);

    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    enableTeacherAttendance();

    await prisma.schoolAttendanceConfig.create({ data: { schoolId: fx.schoolA.id, ...CONFIG } });
    await prisma.schoolAttendanceConfig.create({ data: { schoolId: fx.schoolB.id, ...CONFIG } });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function as(token) {
    return (req) => req.set('Authorization', `Bearer ${token}`);
  }

  describe('feature flag', () => {
    test('returns 503 when TEACHER_ATTENDANCE_ENABLED is not set', async () => {
      delete process.env.TEACHER_ATTENDANCE_ENABLED;
      const res = await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 10 })
      );
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('TEACHER_ATTENDANCE_DISABLED');
      enableTeacherAttendance();
    });
  });

  describe('check-in', () => {
    test('on-time, inside the geofence — 201, Present, no lateMinutes', async () => {
      vi.setSystemTime(istDateTime('2026-08-03', 8, 40));
      const res = await as(teacherA2Token)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(201);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.lateMinutes).toBe(0);
    });

    test('a second check-in the same day is rejected, not overwritten', async () => {
      vi.setSystemTime(istDateTime('2026-08-03', 9, 10));
      const res = await as(teacherA2Token)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(409);
    });

    test('9:05 AM (review doc example 2) — Late by 5 minutes, still Present, no review needed', async () => {
      vi.setSystemTime(istDateTime('2026-08-04', 9, 5));
      const res = await as(teacherAToken)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(201);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.lateMinutes).toBe(5);
    });

    test('10:30 AM — after the check-in window closes, check-in is blocked outright, not flagged-and-allowed', async () => {
      vi.setSystemTime(istDateTime('2026-08-05', 10, 30));
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OUTSIDE_CHECKIN_WINDOW');

      // No attendance row was ever created for the blocked attempt.
      const today = await as(teacherBToken)(request(app).get('/api/teacher-attendance/today'));
      expect(today.body.attendance).toBeNull();
    });

    // Decided rule: check-in has no earliest time, only a latest one — an
    // early arrival (still at the school's location) is never blocked on
    // its own, only arriving after checkinWindowEnd is.
    test('1:16 AM — hours before opening, still succeeds (present, on time) — only the window\'s close and location are enforced', async () => {
      vi.setSystemTime(istDateTime('2026-08-05', 1, 16)); // a Wednesday — not a weekly-off day
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(201);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.lateMinutes).toBe(0);
    });

    test('outside the geofence — blocked outright, never silently marked present or held for review', async () => {
      vi.setSystemTime(istDateTime('2026-08-06', 9, 0));
      const res = await as(teacherA2Token)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: FAR_AWAY.lat, lon: FAR_AWAY.lon, accuracyMeters: 15 })
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TOO_FAR');
      expect(res.body.error).toMatch(/too far/i);
    });

    test('a blocked check-in attempt still leaves a log entry, so there is a record someone tried', async () => {
      vi.setSystemTime(istDateTime('2026-08-28', 9, 0));
      await as(teacherA2Token)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: FAR_AWAY.lat, lon: FAR_AWAY.lon, accuracyMeters: 15 })
      );
      const logs = await prisma.teacherAttendanceActivityLog.findMany({
        where: { userId: fx.teacherA2.id, action: 'check_in_blocked' },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[logs.length - 1].result).toMatch(/blocked/);
    });

    test('a weekly off day (default: Sunday) blocks check-in entirely', async () => {
      // 2026-08-23 is a Sunday; schoolA's config defaults to weeklyOffDays "0".
      // (A date before "today" — vi.setSystemTime moving the clock PAST the
      // real current date would make the already-issued JWT look expired.)
      vi.setSystemTime(istDateTime('2026-08-23', 9, 0));
      const res = await as(teacherA2Token)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WEEKLY_OFF_DAY');
    });

    test('a declared holiday blocks check-in entirely, with the holiday reason in the message', async () => {
      await prisma.schoolHoliday.create({
        data: { schoolId: fx.schoolA.id, date: '2026-08-24', reason: 'Test Holiday', source: 'principal_emergency' },
      });
      vi.setSystemTime(istDateTime('2026-08-24', 9, 0));
      const res = await as(teacherA2Token)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('HOLIDAY');
      expect(res.body.error).toContain('Test Holiday');
    });

    test('GET /today tells the client about a non-working day up front, without needing to attempt check-in', async () => {
      vi.setSystemTime(istDateTime('2026-08-23', 9, 0)); // Sunday
      const res = await as(teacherA2Token)(request(app).get('/api/teacher-attendance/today'));
      expect(res.status).toBe(200);
      expect(res.body.nonWorkingDay).toEqual({
        code: 'WEEKLY_OFF_DAY',
        message: 'Today is a weekly off day for your school — no check-in is needed.',
      });
    });

    test('rejects a client-supplied verdict field — the schema has no such field', async () => {
      vi.setSystemTime(istDateTime('2026-08-07', 9, 0));
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-in')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15, insideGeofence: true })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('check-out', () => {
    test('checking out before checking in is rejected', async () => {
      vi.setSystemTime(istDateTime('2026-08-10', 15, 0));
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_CHECKED_IN');
    });

    test('review doc example 6: in 9:00, out 4:00 PM — full day, no shortfall, not early', async () => {
      vi.setSystemTime(istDateTime('2026-08-11', 9, 0));
      await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );

      vi.setSystemTime(istDateTime('2026-08-11', 16, 0));
      const res = await as(teacherAToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.workingMinutes).toBe(420);
      expect(res.body.attendance.shortfallMinutes).toBe(0);
      expect(res.body.attendance.earlyDepartureMinutes).toBe(0);
    });

    // Decided rule: checkout has no time-of-day gate at all — a teacher
    // physically at school can check out whenever they actually leave.
    // Only location can block it. earlyDepartureMinutes is still recorded
    // (informational — shown in Reports/History), it just no longer blocks
    // the action itself.
    test('checking out well before the early-departure grace succeeds — location is the only gate', async () => {
      vi.setSystemTime(istDateTime('2026-08-12', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );

      // closeTime 16:00, checked in 09:00 -> checking out at 11:00 is only
      // 120 working minutes, under the half-day threshold (210 of the
      // 420-minute required day) — well past the old early-departure
      // cutoff too, and it succeeds anyway.
      vi.setSystemTime(istDateTime('2026-08-12', 11, 0));
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.checkOutAt).not.toBeNull();
      expect(res.body.attendance.status).toBe('half_day'); // a real fact, not a violation
      expect(res.body.attendance.earlyDepartureMinutes).toBeGreaterThan(0);
    });

    test('checking out long after closing time also succeeds — no upper time bound either', async () => {
      vi.setSystemTime(istDateTime('2026-08-13', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.setSystemTime(istDateTime('2026-08-13', 20, 0)); // closeTime 16:00, four hours past
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.checkOutAt).not.toBeNull();
    });

    test('checking out from outside the geofence is blocked outright — the day stays Missing Checkout, not flagged', async () => {
      vi.setSystemTime(istDateTime('2026-08-17', 9, 0));
      await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.setSystemTime(istDateTime('2026-08-17', 16, 0));
      const res = await as(teacherAToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: FAR_AWAY.lat, lon: FAR_AWAY.lon, accuracyMeters: 15 })
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TOO_FAR');

      const today = await as(teacherAToken)(request(app).get('/api/teacher-attendance/today'));
      expect(today.body.attendance.checkOutAt).toBeNull();
    });

    test('a second check-out the same day is rejected', async () => {
      vi.setSystemTime(istDateTime('2026-08-14', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.setSystemTime(istDateTime('2026-08-14', 16, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-out').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      const res = await as(teacherBToken)(
        request(app)
          .post('/api/teacher-attendance/check-out')
          .send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      expect(res.status).toBe(409);
    });
  });

  describe('own view', () => {
    test('GET /today reflects the day just checked in', async () => {
      vi.setSystemTime(istDateTime('2026-08-15', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      const res = await as(teacherBToken)(request(app).get('/api/teacher-attendance/today'));
      expect(res.status).toBe(200);
      expect(res.body.attendance).not.toBeNull();
      expect(res.body.attendance.date).toBe('2026-08-15');
      expect(res.body.attendance.reviewReason).toBeNull(); // never reviewed
    });

    test('GET /history?month=... returns the caller\'s own days for that month only', async () => {
      const res = await as(teacherBToken)(request(app).get('/api/teacher-attendance/history?month=2026-08'));
      expect(res.status).toBe(200);
      expect(res.body.attendance.length).toBeGreaterThan(0);
      for (const day of res.body.attendance) {
        expect(day.date.startsWith('2026-08')).toBe(true);
      }
    });

    test('rejects a malformed month', async () => {
      const res = await as(teacherBToken)(request(app).get('/api/teacher-attendance/history?month=August'));
      expect(res.status).toBe(400);
    });
  });

  describe('missing checkout — pending regularization, never a review queue item', () => {
    test('a past day with a check-in but no check-out reads as pending_regularization on the teacher\'s own History', async () => {
      vi.setSystemTime(istDateTime('2026-06-01', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.useRealTimers(); // "today" is now long after 2026-06-01

      const res = await as(teacherBToken)(request(app).get('/api/teacher-attendance/history?month=2026-06'));
      expect(res.status).toBe(200);
      const day = res.body.attendance.find((r) => r.date === '2026-06-01');
      expect(day).toBeTruthy();
      expect(day.status).toBe('pending_regularization');
    });

    test('there is no review-queue endpoint anymore — nothing auto-flags into one', async () => {
      const res = await as(adminBToken)(request(app).get('/api/teacher-attendance/review-queue'));
      expect(res.status).toBe(404);
    });
  });

  describe('corrections (Principal, on any day — no queue gating)', () => {
    let recordId;

    beforeAll(async () => {
      vi.setSystemTime(istDateTime('2026-05-05', 9, 0));
      const checkIn = await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      recordId = checkIn.body.attendance.id;
      vi.useRealTimers();
    });

    test('reviewing without a reason is rejected', async () => {
      const res = await as(adminAToken)(
        request(app).post(`/api/teacher-attendance/${recordId}/review`).send({ action: 'approve' })
      );
      expect(res.status).toBe(400);
    });

    test("a different school's Principal gets 404, not the record — existence is never leaked", async () => {
      const res = await as(adminBToken)(
        request(app)
          .post(`/api/teacher-attendance/${recordId}/review`)
          .send({ action: 'approve', reason: 'Trying anyway.' })
      );
      expect(res.status).toBe(404);
    });

    test('correcting an ordinary present day writes an audit row, atomically', async () => {
      const res = await as(adminAToken)(
        request(app)
          .post(`/api/teacher-attendance/${recordId}/review`)
          .send({ action: 'approve', reason: 'Confirmed with the teacher — official duty.' })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.reviewReason).toBe('Confirmed with the teacher — official duty.');

      const reviews = await prisma.teacherAttendanceReview.findMany({ where: { attendanceId: recordId } });
      expect(reviews).toHaveLength(1);
      expect(reviews[0].reviewedByUserId).toBe(fx.schoolAdminA.id);
      expect(reviews[0].reason).toBe('Confirmed with the teacher — official duty.');
    });

    test("the reviewed teacher later sees the Principal's reason on their own History — not just the final status", async () => {
      const res = await as(teacherAToken)(request(app).get('/api/teacher-attendance/history?month=2026-05'));
      expect(res.status).toBe(200);
      const day = res.body.attendance.find((r) => r.id === recordId);
      expect(day).toBeTruthy();
      expect(day.reviewReason).toBe('Confirmed with the teacher — official duty.');
    });

    test('correcting a missing checkout never re-flags the day, even if the corrected time falls "outside the window"', async () => {
      vi.setSystemTime(istDateTime('2026-05-06', 9, 0));
      const checkIn = await as(teacherA2Token)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.useRealTimers();
      const id = checkIn.body.attendance.id;

      const res = await as(adminAToken)(
        request(app)
          .post(`/api/teacher-attendance/${id}/review`)
          .send({
            action: 'correct_checkout',
            reason: 'Confirmed departure time from the office register.',
            correctedCheckOutAt: istDateTime('2026-05-06', 16, 0).toISOString(),
          })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('present');
    });

    test('correcting a checkout to an early time is never blocked — only the live checkout endpoint enforces the early-departure cutoff', async () => {
      vi.setSystemTime(istDateTime('2026-05-07', 9, 0));
      const checkIn = await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.useRealTimers();
      const id = checkIn.body.attendance.id;

      const res = await as(adminAToken)(
        request(app)
          .post(`/api/teacher-attendance/${id}/review`)
          .send({
            action: 'correct_checkout',
            reason: 'Left for a medical appointment, confirmed with the teacher directly.',
            correctedCheckOutAt: istDateTime('2026-05-07', 11, 0).toISOString(), // well before the 15:45 cutoff
          })
      );
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('half_day');
    });

    test('marking a day on leave requires a category, and records it', async () => {
      vi.setSystemTime(istDateTime('2026-08-21', 9, 0));
      const checkIn = await as(teacherA2Token)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.useRealTimers();
      const recordId2 = checkIn.body.attendance.id;

      const missingCategory = await as(adminAToken)(
        request(app)
          .post(`/api/teacher-attendance/${recordId2}/review`)
          .send({ action: 'mark_on_leave', reason: 'Applied for leave.' })
      );
      expect(missingCategory.status).toBe(400);

      const withCategory = await as(adminAToken)(
        request(app)
          .post(`/api/teacher-attendance/${recordId2}/review`)
          .send({ action: 'mark_on_leave', reason: 'Applied for leave.', leaveOrDutyCategory: 'Medical Leave' })
      );
      expect(withCategory.status).toBe(200);
      expect(withCategory.body.attendance.status).toBe('on_leave');
      expect(withCategory.body.attendance.leaveOrDutyCategory).toBe('Medical Leave');
    });

    test('a correction writes an activity-log row too, with who performed it', async () => {
      const logs = await prisma.teacherAttendanceActivityLog.findMany({
        where: { userId: fx.teacherA.id, action: 'correction' },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].performedBy).toBe(fx.schoolAdminA.id);
    });
  });

  describe('school config', () => {
    test('a plain teacher can VIEW the school config, but not edit it', async () => {
      const getRes = await as(teacherAToken)(request(app).get('/api/teacher-attendance/school-config'));
      expect(getRes.status).toBe(200);
      expect(getRes.body.config.openTime).toBe(CONFIG.openTime);

      const putRes = await as(teacherAToken)(
        request(app).put('/api/teacher-attendance/school-config').send(CONFIG)
      );
      expect(putRes.status).toBe(403);
    });

    test("the Principal can update their own school's config", async () => {
      const res = await as(adminAToken)(
        request(app)
          .put('/api/teacher-attendance/school-config')
          .send({ ...CONFIG, geofenceRadiusMeters: 200 })
      );
      expect(res.status).toBe(200);
      expect(res.body.config.geofenceRadiusMeters).toBe(200);

      const logs = await prisma.teacherAttendanceActivityLog.findMany({
        where: { schoolId: fx.schoolA.id, action: 'settings_changed' },
      });
      expect(logs.length).toBeGreaterThan(0);
    });

    test('rejects a malformed time string', async () => {
      const res = await as(adminAToken)(
        request(app)
          .put('/api/teacher-attendance/school-config')
          .send({ ...CONFIG, openTime: '9am' })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('holidays', () => {
    test('the Principal can add a holiday', async () => {
      const res = await as(adminAToken)(
        request(app).post('/api/teacher-attendance/holidays').send({ date: '2026-10-02', reason: 'Gandhi Jayanti' })
      );
      expect(res.status).toBe(201);
      expect(res.body.holiday.source).toBe('principal_emergency');
    });

    test('a duplicate date is rejected', async () => {
      const res = await as(adminAToken)(
        request(app).post('/api/teacher-attendance/holidays').send({ date: '2026-10-02', reason: 'Duplicate' })
      );
      expect(res.status).toBe(409);
    });

    test('a plain teacher can list holidays but not create one', async () => {
      const listRes = await as(teacherAToken)(request(app).get('/api/teacher-attendance/holidays'));
      expect(listRes.status).toBe(200);
      expect(listRes.body.holidays.some((h) => h.date === '2026-10-02')).toBe(true);

      const createRes = await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/holidays').send({ date: '2026-11-01', reason: 'Trying anyway' })
      );
      expect(createRes.status).toBe(403);
    });

    describe('editing and deleting', () => {
      let holidayId;

      beforeAll(async () => {
        const res = await as(adminAToken)(
          request(app).post('/api/teacher-attendance/holidays').send({ date: '2026-12-25', reason: 'Christmas (typo)' })
        );
        holidayId = res.body.holiday.id;
      });

      test('the Principal can fix a typo in the reason without changing the date', async () => {
        const res = await as(adminAToken)(
          request(app)
            .put(`/api/teacher-attendance/holidays/${holidayId}`)
            .send({ date: '2026-12-25', reason: 'Christmas' })
        );
        expect(res.status).toBe(200);
        expect(res.body.holiday.reason).toBe('Christmas');

        const listRes = await as(adminAToken)(request(app).get('/api/teacher-attendance/holidays'));
        expect(listRes.body.holidays.find((h) => h.id === holidayId).reason).toBe('Christmas');
      });

      test('editing into a date that collides with another holiday is rejected, not silently merged', async () => {
        const res = await as(adminAToken)(
          request(app)
            .put(`/api/teacher-attendance/holidays/${holidayId}`)
            .send({ date: '2026-10-02', reason: 'Christmas' }) // already taken by the Gandhi Jayanti holiday above
        );
        expect(res.status).toBe(409);
      });

      test('a plain teacher cannot edit or delete a holiday', async () => {
        const putRes = await as(teacherAToken)(
          request(app)
            .put(`/api/teacher-attendance/holidays/${holidayId}`)
            .send({ date: '2026-12-25', reason: 'Trying anyway' })
        );
        expect(putRes.status).toBe(403);

        const deleteRes = await as(teacherAToken)(request(app).delete(`/api/teacher-attendance/holidays/${holidayId}`));
        expect(deleteRes.status).toBe(403);
      });

      test("a different school's Principal gets 404 editing or deleting it — existence never leaked", async () => {
        const putRes = await as(adminBToken)(
          request(app)
            .put(`/api/teacher-attendance/holidays/${holidayId}`)
            .send({ date: '2026-12-25', reason: 'Trying anyway' })
        );
        expect(putRes.status).toBe(404);

        const deleteRes = await as(adminBToken)(request(app).delete(`/api/teacher-attendance/holidays/${holidayId}`));
        expect(deleteRes.status).toBe(404);
      });

      test('the Principal can delete a holiday, and it stops appearing in the list', async () => {
        const res = await as(adminAToken)(request(app).delete(`/api/teacher-attendance/holidays/${holidayId}`));
        expect(res.status).toBe(204);

        const listRes = await as(adminAToken)(request(app).get('/api/teacher-attendance/holidays'));
        expect(listRes.body.holidays.some((h) => h.id === holidayId)).toBe(false);
      });

      test('deleting an already-deleted holiday is 404, not a crash', async () => {
        const res = await as(adminAToken)(request(app).delete(`/api/teacher-attendance/holidays/${holidayId}`));
        expect(res.status).toBe(404);
      });
    });
  });

  describe('whole-school report (Principal) — paginated summary list + per-teacher detail + Excel export', () => {
    const REPORT_MONTH = '2026-07'; // isolated from every other date used elsewhere in this file

    beforeAll(async () => {
      // schoolA's config was created at real test-run "now" (top-of-file
      // beforeAll, unfaked) — which is chronologically AFTER 2026-07, so
      // without this, sinceDateFor would (correctly, by design) treat July
      // as "before tracking started" and exclude it entirely. Forced back
      // to a fixed early date so this describe block's month is safely
      // "after config existed," independent of whatever the real clock
      // happens to read when this suite runs.
      // Same reasoning for the teachers' own account creation dates — also
      // real test-run "now" from createFixtures(), also after 2026-07.
      await prisma.schoolAttendanceConfig.update({
        where: { schoolId: fx.schoolA.id },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      await prisma.user.updateMany({
        where: { id: { in: [fx.teacherA.id, fx.teacherA2.id, fx.schoolAdminA.id] } },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      vi.setSystemTime(istDateTime('2026-07-06', 9, 0)); // Monday, on-time
      await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.setSystemTime(istDateTime('2026-07-06', 16, 0));
      await as(teacherAToken)(
        request(app).post('/api/teacher-attendance/check-out').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );

      // A different school entirely — must never appear in schoolA's report.
      vi.setSystemTime(istDateTime('2026-07-07', 9, 0));
      await as(teacherBToken)(
        request(app).post('/api/teacher-attendance/check-in').send({ lat: 12.9716, lon: 77.5946, accuracyMeters: 15 })
      );
      vi.useRealTimers();
    });

    test('a plain teacher cannot reach the school-history report', async () => {
      const res = await as(teacherAToken)(request(app).get(`/api/teacher-attendance/school-history?month=${REPORT_MONTH}`));
      expect(res.status).toBe(403);
    });

    test('an invalid month is rejected', async () => {
      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/school-history?month=bad'));
      expect(res.status).toBe(400);
    });

    test('the list is summary-only and paginated — every teacher is listed even with zero records', async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/school-history?month=${REPORT_MONTH}&pageSize=50`)
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.page).toBe(1);
      const teacherAEntry = res.body.teachers.find((t) => t.id === fx.teacherA.id);
      expect(teacherAEntry.summary.present).toBeGreaterThanOrEqual(1);
      expect(teacherAEntry.records).toBeUndefined(); // summary-only, no per-day detail in the list
      expect(res.body.teachers.some((t) => t.id === fx.teacherA2.id)).toBe(true); // no records at all this month
    });

    test('pageSize actually limits the page', async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/school-history?month=${REPORT_MONTH}&pageSize=1&page=1`)
      );
      expect(res.status).toBe(200);
      expect(res.body.teachers).toHaveLength(1);
      expect(res.body.total).toBeGreaterThan(1);
    });

    test("a different school's records never leak into this school's report — tenant isolation", async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/school-history?month=${REPORT_MONTH}&pageSize=50`)
      );
      expect(res.body.teachers.some((t) => t.id === fx.teacherB.id)).toBe(false);
    });

    test("a specific teacher's detail fetch returns their real day-by-day records", async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/school-history/${fx.teacherA.id}?month=${REPORT_MONTH}`)
      );
      expect(res.status).toBe(200);
      expect(res.body.teacher.id).toBe(fx.teacherA.id);
      expect(res.body.records.some((r) => r.date === '2026-07-06' && r.status === 'present')).toBe(true);
    });

    test("a different school's Principal gets 404 for a teacher detail fetch, not another school's data", async () => {
      const res = await as(adminBToken)(
        request(app).get(`/api/teacher-attendance/school-history/${fx.teacherA.id}?month=${REPORT_MONTH}`)
      );
      expect(res.status).toBe(404);
    });

    test('a plain teacher cannot download the export', async () => {
      const res = await as(teacherAToken)(
        request(app).get(`/api/teacher-attendance/school-history/export?month=${REPORT_MONTH}`)
      );
      expect(res.status).toBe(403);
    });

    async function loadExportWorkbook(token, month) {
      const res = await as(token)(
        request(app).get(`/api/teacher-attendance/school-history/export?month=${month}`).buffer(true).parse(binaryParser)
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      return { res, sheet: workbook.worksheets[0] };
    }

    test('the export is a real Excel file with the right headers, and a row for the teacher who checked in', async () => {
      const { res, sheet } = await loadExportWorkbook(adminAToken, REPORT_MONTH);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
      expect(res.headers['content-disposition']).toMatch(/attendance\.xlsx/);
      expect(sheet.getRow(1).values.slice(1)).toEqual([
        'Teacher', 'Email', 'Present', 'Absent', 'Late', 'Half day', 'On leave', 'On duty', 'Needs review', 'Missing checkout',
      ]);

      const rows = [];
      sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) rows.push(row.values.slice(1)); });
      const teacherARow = rows.find((r) => r[1] === fx.teacherA.email);
      expect(teacherARow[2]).toBeGreaterThanOrEqual(1); // Present count includes July 6
    });

    test("a different school's teachers never appear in this school's export", async () => {
      const { sheet } = await loadExportWorkbook(adminAToken, REPORT_MONTH);
      const rows = [];
      sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) rows.push(row.values.slice(1)); });
      expect(rows.some((r) => r[1] === fx.teacherB.email)).toBe(false);
    });
  });

  describe('today-summary (Reports dashboard cards)', () => {
    // Whatever real calendar day these tests happen to run on could be a
    // Sunday — schoolA's config defaults weeklyOffDays to "0" — which would
    // make the endpoint correctly return all-zero "non-working day" counts
    // regardless of the records seeded below. Cleared for this block only,
    // so the test is deterministic no matter what day it's actually run.
    let savedWeeklyOffDays;
    beforeAll(async () => {
      const config = await prisma.schoolAttendanceConfig.findUnique({ where: { schoolId: fx.schoolA.id } });
      savedWeeklyOffDays = config.weeklyOffDays;
      await prisma.schoolAttendanceConfig.update({ where: { schoolId: fx.schoolA.id }, data: { weeklyOffDays: '' } });
    });
    afterAll(async () => {
      await prisma.schoolAttendanceConfig.update({ where: { schoolId: fx.schoolA.id }, data: { weeklyOffDays: savedWeeklyOffDays } });
    });

    test('a plain teacher cannot reach it', async () => {
      const res = await as(teacherAToken)(request(app).get('/api/teacher-attendance/today-summary'));
      expect(res.status).toBe(403);
    });

    test('counts present/late/missing-checkout/absent for today across the school', async () => {
      vi.useRealTimers(); // "today" = the real current date, same as the endpoint itself reads
      const today = istDateString(new Date());
      // Clean slate for today specifically, in case an earlier test in this
      // file happened to touch it.
      await prisma.teacherAttendance.deleteMany({ where: { schoolId: fx.schoolA.id, date: today } });

      await prisma.teacherAttendance.create({
        data: {
          userId: fx.teacherA.id,
          schoolId: fx.schoolA.id,
          date: today,
          checkInAt: new Date(),
          checkOutAt: new Date(),
          status: 'present',
          lateMinutes: 10,
          workingMinutes: 400,
        },
      });
      await prisma.teacherAttendance.create({
        data: {
          userId: fx.teacherA2.id,
          schoolId: fx.schoolA.id,
          date: today,
          checkInAt: new Date(),
          status: 'present',
          lateMinutes: 0,
        },
      });
      // schoolAdminA has no record today — counts toward absent.

      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/today-summary'));
      expect(res.status).toBe(200);
      expect(res.body.present).toBeGreaterThanOrEqual(2);
      expect(res.body.late).toBeGreaterThanOrEqual(1);
      expect(res.body.missingCheckout).toBeGreaterThanOrEqual(1);
      expect(res.body.absent).toBeGreaterThanOrEqual(1);
    });

    test("a different school's Principal sees only their own school's counts", async () => {
      vi.useRealTimers();
      const today = istDateString(new Date());
      const res = await as(adminBToken)(request(app).get('/api/teacher-attendance/today-summary'));
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(today);
      // schoolB has no attendance activity from this describe block at all.
      expect(res.body.present).toBe(0);
    });
  });

  describe('activity log', () => {
    test('a plain teacher cannot reach the activity log', async () => {
      const res = await as(teacherAToken)(request(app).get('/api/teacher-attendance/activity-log'));
      expect(res.status).toBe(403);
    });

    test('defaults to the last 7 days, not "everything" — an old event outside the window is excluded', async () => {
      const old = await prisma.teacherAttendanceActivityLog.create({
        data: {
          schoolId: fx.schoolA.id,
          userId: fx.teacherA.id,
          action: 'check_in',
          result: 'old event',
          createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        },
      });
      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/activity-log'));
      expect(res.status).toBe(200);
      expect(res.body.days).toBe(7);
      expect(res.body.entries.some((e) => e.id === old.id)).toBe(false);
    });

    test('a wider day range does surface it', async () => {
      // pageSize large enough to guarantee the deliberately-old row (oldest
      // in the window, so last in newest-first order) isn't pushed off the
      // first page by everything else this file's many check-ins/corrections
      // have already logged for schoolA.
      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/activity-log?days=90&pageSize=100'));
      expect(res.status).toBe(200);
      expect(res.body.entries.some((e) => e.result === 'old event')).toBe(true);
    });

    test("a different school's Principal never sees this school's log — tenant isolation", async () => {
      const res = await as(adminBToken)(request(app).get('/api/teacher-attendance/activity-log?days=90'));
      expect(res.status).toBe(200);
      expect(res.body.entries.some((e) => e.result === 'old event')).toBe(false);
    });

    test('filters by userId', async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/activity-log?days=90&userId=${fx.teacherA2.id}`)
      );
      expect(res.status).toBe(200);
      expect(res.body.entries.every((e) => e.userId === fx.teacherA2.id)).toBe(true);
    });

    test('category=teacher excludes administrative housekeeping (settings/holiday changes, corrections)', async () => {
      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/activity-log?days=90&category=teacher&pageSize=200'));
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThan(0);
      expect(res.body.entries.every((e) => !['settings_changed', 'holiday_changed', 'correction', 'mark_on_leave', 'mark_on_duty'].includes(e.action))).toBe(true);
    });

    test('category=admin shows only administrative housekeeping', async () => {
      const res = await as(adminAToken)(request(app).get('/api/teacher-attendance/activity-log?days=90&category=admin&pageSize=200'));
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThan(0);
      expect(res.body.entries.every((e) => ['settings_changed', 'holiday_changed', 'correction', 'mark_on_leave', 'mark_on_duty'].includes(e.action))).toBe(true);
    });

    test('search filters by the teacher\'s name', async () => {
      const res = await as(adminAToken)(
        request(app).get(`/api/teacher-attendance/activity-log?days=90&search=${encodeURIComponent(fx.teacherA2.name)}&pageSize=200`)
      );
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThan(0);
      expect(res.body.entries.every((e) => e.userName === fx.teacherA2.name)).toBe(true);
    });
  });
});
