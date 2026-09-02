// Teacher Attendance — see docs/feature-teacher-attendance-implementation-plan.md
// and docs/attendance-plan-review.md (the policy decisions this file
// implements).
//
// NOT to be confused with routes/classroom.js's student attendance
// (SchoolClass/Student/AttendanceRecord) — that's a teacher marking THEIR
// STUDENTS present/absent. This file is a teacher's own attendance,
// reviewed by their school's Principal (role = school_admin).
//
// The one rule everything here follows (attendance-system-design.html §6):
// the client sends only raw evidence (lat/lon/accuracy/device id) — never a
// verdict — and the server always recomputes geofence distance and status
// itself via lib/teacherAttendance.js. checkInSchema/checkOutSchema in
// teacherAttendanceSchema.js have no field for a client-supplied "inside:
// true" for exactly this reason.
const express = require('express');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { readTeacherAttendanceFlags } = require('../lib/flags');
const { isValidMonth } = require('../lib/classroomAttendance');
const {
  distanceMeters,
  isWithinGeofence,
  classifyArrival,
  computeEarlyDeparture,
  computeWorkingMinutes,
  computeRequiredMinutes,
  deriveDayStatus,
  istDateString,
  isWeeklyOff,
  deriveEffectiveStatus,
  sinceDateFor,
  datesInMonth,
  summarizeTeacherMonth,
} = require('../lib/teacherAttendance');
const {
  checkInSchema,
  checkOutSchema,
  reviewActionSchema,
  schoolAttendanceConfigSchema,
  createHolidaySchema,
} = require('../lib/teacherAttendanceSchema');
const { buildAttendanceReportWorkbook } = require('../lib/teacherAttendanceReportExcel');
const { logTeacherAttendanceActivity: logActivity } = require('../lib/teacherAttendanceActivityLog');

const router = express.Router();

function sanitizeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'export';
}

/**
 * Same rollout predicate shape as routes/classroom.js's
 * isWithinClassroomRollout: `enabled` is the gate, `allowedSchoolCodes` is a
 * FILTER on top of it (empty means every school).
 */
async function isWithinTeacherAttendanceRollout(user, flags) {
  if (!flags.enabled) return false;
  if (flags.allowedSchoolCodes.length === 0) return true;
  try {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
    return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
  } catch {
    return false; // fails closed, same reasoning as classroom.js/attachments.js
  }
}

/**
 * Gate middleware — same shape as routes/classroom.js's
 * requireClassroomManagementEnabled: flags read LIVE (process.env), applied
 * per-route rather than router-wide (this router self-prefixes with
 * "/teacher-attendance/..." and mounts at the bare "/api" — see index.js).
 */
function requireTeacherAttendanceEnabled() {
  return asyncHandler(async (req, res, next) => {
    const flags = readTeacherAttendanceFlags(process.env);
    if (!(await isWithinTeacherAttendanceRollout(req.user, flags))) {
      return res
        .status(503)
        .json({ error: 'This feature is not available right now.', code: 'TEACHER_ATTENDANCE_DISABLED' });
    }
    return next();
  });
}

const gate = [authRequired, requireTeacherAttendanceEnabled()];
const adminGate = [authRequired, requireRole('school_admin'), requireTeacherAttendanceEnabled()];

// ---- DTOs -------------------------------------------------------------------

/**
 * A teacher's own view of one day — evidence fields (raw GPS, device id) are
 * deliberately omitted. `record._count.reviews` (from an `include` on the
 * query that produced this row) tells deriveEffectiveStatus whether a
 * Principal has already resolved a missing-checkout day, so an approved/
 * corrected/leave-marked record doesn't keep reading as still-pending — see
 * deriveEffectiveStatus's own doc comment. A caller that just created a
 * review in the same request (the review-action route) can pass
 * `{ justReviewed: true }` instead of re-querying for the count.
 *
 * `reviewReason` surfaces the Principal's own typed reason (from the latest
 * TeacherAttendanceReview row, when the query's `include` loaded it as
 * `reviews`) — so a teacher looking at their History can see *why* a day
 * was resolved the way it was, not just the final status. `null` when the
 * day was never reviewed, or when the caller's query didn't load `reviews`
 * (the review-queue route never does, since those records are unreviewed
 * by definition).
 */
function attendanceToDto(record, { justReviewed = false } = {}) {
  const today = istDateString(new Date());
  const wasReviewed = justReviewed || (record._count?.reviews ?? 0) > 0;
  return {
    id: record.id,
    date: record.date,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    status: deriveEffectiveStatus({ ...record, wasReviewed }, today),
    lateMinutes: record.lateMinutes,
    earlyDepartureMinutes: record.earlyDepartureMinutes,
    workingMinutes: record.workingMinutes,
    shortfallMinutes: record.shortfallMinutes,
    leaveOrDutyCategory: record.leaveOrDutyCategory,
    leaveOrDutyReason: record.leaveOrDutyReason,
    reviewReason: record.reviews?.[0]?.reason ?? null,
  };
}

/** The Principal's per-day detail view of one teacher's record — includes the raw evidence a correction decision needs. */
function attendanceToDetailDto(record) {
  return {
    ...attendanceToDto(record),
    teacher: record.user ? { id: record.user.id, name: record.user.name, email: record.user.email } : undefined,
    checkInLat: record.checkInLat,
    checkInLon: record.checkInLon,
    checkInAccuracyMeters: record.checkInAccuracyMeters,
    checkInDistanceMeters: record.checkInDistanceMeters,
    checkInDeviceId: record.checkInDeviceId,
    checkOutLat: record.checkOutLat,
    checkOutLon: record.checkOutLon,
    checkOutAccuracyMeters: record.checkOutAccuracyMeters,
    checkOutDistanceMeters: record.checkOutDistanceMeters,
    checkOutDeviceId: record.checkOutDeviceId,
  };
}

async function getSchoolConfig(schoolId) {
  return prisma.schoolAttendanceConfig.findUnique({ where: { schoolId } });
}

const NO_CONFIG_RESPONSE = {
  error: 'Attendance is not set up for your school yet. Ask your Principal to configure it.',
  code: 'NO_SCHOOL_CONFIG',
};

/**
 * Is `now` a day this school doesn't expect anyone to check in at all — a
 * weekly off day (e.g. every Sunday) or a declared holiday? Checked before
 * check-in is allowed to even start, per the review doc's edge case: "a
 * declared holiday shouldn't ask anyone to check in."
 * @returns {Promise<{code: string, message: string} | null>}
 */
async function getNonWorkingDayReason(schoolId, now, config) {
  if (isWeeklyOff(now, config)) {
    return { code: 'WEEKLY_OFF_DAY', message: 'Today is a weekly off day for your school — no check-in is needed.' };
  }
  const date = istDateString(now);
  const holiday = await prisma.schoolHoliday.findUnique({ where: { schoolId_date: { schoolId, date } } });
  if (holiday) {
    return { code: 'HOLIDAY', message: `Today is a holiday (${holiday.reason}) — no check-in is needed.` };
  }
  return null;
}

// ---- Check-in / check-out ----------------------------------------------------

router.post(
  '/teacher-attendance/check-in',
  ...gate,
  asyncHandler(async (req, res) => {
    const parsed = checkInSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid check-in.' });
    }
    const config = await getSchoolConfig(req.user.schoolId);
    if (!config) return res.status(409).json(NO_CONFIG_RESPONSE);

    const now = new Date();
    const nonWorkingDay = await getNonWorkingDayReason(req.user.schoolId, now, config);
    if (nonWorkingDay) {
      return res.status(409).json({ error: nonWorkingDay.message, code: nonWorkingDay.code });
    }

    const date = istDateString(now);
    const existing = await prisma.teacherAttendance.findUnique({
      where: { userId_date: { userId: req.user.id, date } },
    });
    if (existing?.checkInAt) {
      return res.status(409).json({ error: 'You already checked in today.', attendance: attendanceToDto(existing) });
    }

    const { lat, lon, accuracyMeters, deviceId } = parsed.data;
    const distance = distanceMeters(lat, lon, config.geofenceLat, config.geofenceLon);
    const withinGeofence = isWithinGeofence(distance, config);

    // Redesigned behavior (docs/feature-teacher-attendance-implementation-plan.md
    // §1.2/§4): too far or outside the check-in window is a hard block, not
    // an allowed-but-flagged record. Nothing is written to TeacherAttendance
    // for a blocked attempt — only a log entry, so there's still a record
    // that someone tried, without a queue anyone has to process.
    if (!withinGeofence) {
      await logActivity({
        schoolId: req.user.schoolId,
        userId: req.user.id,
        action: 'check_in_blocked',
        result: `blocked, ${Math.round(distance)}m from school`,
        lat,
        lon,
        distanceMeters: distance,
      });
      return res.status(403).json({
        error: `You're too far from school to check in (${Math.round(distance)}m away).`,
        code: 'TOO_FAR',
      });
    }

    const arrival = classifyArrival(now, config);
    if (arrival.classification === 'outside_window') {
      await logActivity({
        schoolId: req.user.schoolId,
        userId: req.user.id,
        action: 'check_in_blocked',
        result: 'blocked, outside the check-in window',
        lat,
        lon,
        distanceMeters: distance,
      });
      return res.status(403).json({
        error: 'The check-in window for today has closed.',
        code: 'OUTSIDE_CHECKIN_WINDOW',
      });
    }

    const evidence = {
      checkInAt: now,
      checkInLat: lat,
      checkInLon: lon,
      checkInAccuracyMeters: accuracyMeters,
      checkInDistanceMeters: distance,
      checkInDeviceId: deviceId ?? null,
      status: 'present',
      lateMinutes: arrival.lateMinutes,
    };

    const record = existing
      ? await prisma.teacherAttendance.update({ where: { id: existing.id }, data: evidence })
      : await prisma.teacherAttendance.create({
          data: { userId: req.user.id, schoolId: req.user.schoolId, date, ...evidence },
        });

    await logActivity({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      action: 'check_in',
      result: `${Math.round(distance)}m from school${arrival.lateMinutes ? `, late ${arrival.lateMinutes}m` : ''}`,
      lat,
      lon,
      distanceMeters: distance,
    });

    return res.status(201).json({ attendance: attendanceToDto(record) });
  })
);

router.post(
  '/teacher-attendance/check-out',
  ...gate,
  asyncHandler(async (req, res) => {
    const parsed = checkOutSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid check-out.' });
    }
    const config = await getSchoolConfig(req.user.schoolId);
    if (!config) return res.status(409).json(NO_CONFIG_RESPONSE);

    const now = new Date();
    const date = istDateString(now);
    const existing = await prisma.teacherAttendance.findUnique({
      where: { userId_date: { userId: req.user.id, date } },
    });
    if (!existing?.checkInAt) {
      return res.status(400).json({ error: 'Check in before you can check out.', code: 'NOT_CHECKED_IN' });
    }
    if (existing.checkOutAt) {
      return res
        .status(409)
        .json({ error: 'You already checked out today.', attendance: attendanceToDto(existing) });
    }

    // Checkout has no time-of-day gate at all, deliberately — unlike
    // check-in (which still has an upper bound, checkinWindowEnd), a
    // teacher physically at school can check out whenever they actually
    // leave. Location is the only thing that can block it (below).
    // earlyDepartureMinutes is still computed and recorded — it's real,
    // useful information for Reports/History — it just no longer blocks
    // the action itself.
    const earlyDeparture = computeEarlyDeparture(now, config);

    const { lat, lon, accuracyMeters, deviceId } = parsed.data;
    const distance = distanceMeters(lat, lon, config.geofenceLat, config.geofenceLon);
    const withinGeofence = isWithinGeofence(distance, config);

    if (!withinGeofence) {
      await logActivity({
        schoolId: req.user.schoolId,
        userId: req.user.id,
        action: 'check_out_blocked',
        result: `blocked, ${Math.round(distance)}m from school`,
        lat,
        lon,
        distanceMeters: distance,
      });
      return res.status(403).json({
        error: `You're too far from school to check out (${Math.round(distance)}m away).`,
        code: 'TOO_FAR',
      });
    }

    const workingMinutes = computeWorkingMinutes(existing.checkInAt, now);
    const requiredMinutes = computeRequiredMinutes(config);
    const { dayStatus, shortfallMinutes } = deriveDayStatus(workingMinutes, requiredMinutes, config);

    // A short working day (even an implausibly short one — check in,
    // immediately check out) is recorded as exactly what it is — Half Day
    // plus the real shortfallMinutes — never auto-escalated to a Principal
    // review. It's a fact, not a violation (decision §1.6).
    const status = dayStatus === 'half_day' ? 'half_day' : 'present';

    const record = await prisma.teacherAttendance.update({
      where: { id: existing.id },
      data: {
        checkOutAt: now,
        checkOutLat: lat,
        checkOutLon: lon,
        checkOutAccuracyMeters: accuracyMeters,
        checkOutDeviceId: deviceId ?? null,
        checkOutDistanceMeters: distance,
        workingMinutes,
        shortfallMinutes,
        earlyDepartureMinutes: earlyDeparture.earlyMinutes,
        status,
      },
    });

    await logActivity({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      action: 'check_out',
      result: `${Math.round(distance)}m from school, worked ${workingMinutes}m`,
      lat,
      lon,
      distanceMeters: distance,
    });

    return res.json({ attendance: attendanceToDto(record) });
  })
);

// ---- Own view -----------------------------------------------------------------

router.get(
  '/teacher-attendance/today',
  ...gate,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const date = istDateString(now);
    const record = await prisma.teacherAttendance.findUnique({
      where: { userId_date: { userId: req.user.id, date } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { reason: true } } },
    });
    // Lets the check-in page show "today is a holiday" up front, instead of
    // only finding out after tapping Check In and getting an error back.
    const config = await getSchoolConfig(req.user.schoolId);
    const nonWorkingDay = config ? await getNonWorkingDayReason(req.user.schoolId, now, config) : null;
    res.json({ attendance: record ? attendanceToDto(record) : null, nonWorkingDay });
  })
);

router.get(
  '/teacher-attendance/history',
  ...gate,
  asyncHandler(async (req, res) => {
    const month = req.query.month;
    if (!isValidMonth(month)) {
      return res.status(400).json({ error: 'month must be "YYYY-MM".' });
    }
    const records = await prisma.teacherAttendance.findMany({
      where: { userId: req.user.id, date: { startsWith: month } },
      include: {
        _count: { select: { reviews: true } },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { reason: true } },
      },
      orderBy: { date: 'asc' },
    });
    res.json({ month, attendance: records.map((r) => attendanceToDto(r)) });
  })
);

/**
 * Today's counts across the whole school — the Principal's landing glance
 * on the Reports tab (docs/attendance-register-design.html §5): four
 * numbers, not a table, before any per-teacher detail. `absent` here is a
 * simple roster-size-minus-anyone-with-a-record count (present, half_day,
 * on_leave, on_duty, or flagged_review today all count as "not absent") —
 * intentionally not the same richer "filled-in calendar" absence logic
 * buildRows/summarizeRows use for a full month, since today's dashboard
 * just needs a fast, honest headline number.
 */
router.get(
  '/teacher-attendance/today-summary',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const today = istDateString(now);
    const config = await getSchoolConfig(req.user.schoolId);
    const nonWorkingDay = config ? await getNonWorkingDayReason(req.user.schoolId, now, config) : null;
    if (nonWorkingDay) {
      return res.json({ date: today, nonWorkingDay, present: 0, late: 0, missingCheckout: 0, absent: 0 });
    }

    const [totalUsers, records] = await Promise.all([
      prisma.user.count({ where: { schoolId: req.user.schoolId, role: { in: ['teacher', 'school_admin'] } } }),
      prisma.teacherAttendance.findMany({
        where: { schoolId: req.user.schoolId, date: today },
        select: { status: true, lateMinutes: true, checkInAt: true, checkOutAt: true },
      }),
    ]);

    const present = records.filter((r) => r.status === 'present' || r.status === 'half_day').length;
    const late = records.filter((r) => (r.lateMinutes ?? 0) > 0).length;
    const missingCheckout = records.filter((r) => r.checkInAt && !r.checkOutAt).length;
    const absent = Math.max(0, totalUsers - records.length);

    res.json({ date: today, nonWorkingDay: null, present, late, missingCheckout, absent });
  })
);

// ---- Whole-school report (Principal) ---------------------------------------------

/**
 * Every teacher's SUMMARY for one school+month, paginated — the list view
 * behind the Reports table. Deliberately summary-only, not full day-by-day
 * records: sending every teacher's full month up front doesn't scale past a
 * handful of teachers (docs/feature-teacher-attendance-implementation-plan.md
 * §7). A specific teacher's day-by-day detail is a separate call, below.
 */
router.get(
  '/teacher-attendance/school-history',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const month = req.query.month;
    if (!isValidMonth(month)) {
      return res.status(400).json({ error: 'month must be "YYYY-MM".' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where = {
      schoolId: req.user.schoolId,
      role: { in: ['teacher', 'school_admin'] },
      ...(search ? { name: { contains: search } } : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const [config, holidays] = await Promise.all([
      getSchoolConfig(req.user.schoolId),
      prisma.schoolHoliday.findMany({ where: { schoolId: req.user.schoolId, date: { startsWith: month } } }),
    ]);
    const holidayDates = new Set(holidays.map((h) => h.date));
    const today = istDateString(new Date());

    const userIds = users.map((u) => u.id);
    const records = userIds.length
      ? await prisma.teacherAttendance.findMany({
          where: { schoolId: req.user.schoolId, userId: { in: userIds }, date: { startsWith: month } },
          include: { _count: { select: { reviews: true } } },
        })
      : [];
    const recordsByUser = new Map();
    for (const record of records) {
      const list = recordsByUser.get(record.userId) ?? [];
      list.push(attendanceToDto(record));
      recordsByUser.set(record.userId, list);
    }

    const teachers = users.map((u) => {
      const userRecords = recordsByUser.get(u.id) ?? [];
      const dates = config
        ? datesInMonth(month, today, sinceDateFor(config, u.createdAt))
        : userRecords.map((r) => r.date);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        summary: summarizeTeacherMonth(dates, userRecords, config ?? { weeklyOffDays: '' }, holidayDates),
      };
    });

    res.json({ month, page, pageSize, total, teachers });
  })
);

router.get(
  '/teacher-attendance/school-history/export',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const month = req.query.month;
    if (!isValidMonth(month)) {
      return res.status(400).json({ error: 'month must be "YYYY-MM".' });
    }
    const [users, records, config, holidays, school] = await Promise.all([
      prisma.user.findMany({
        where: { schoolId: req.user.schoolId, role: { in: ['teacher', 'school_admin'] } },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      prisma.teacherAttendance.findMany({
        where: { schoolId: req.user.schoolId, date: { startsWith: month } },
        include: { _count: { select: { reviews: true } } },
      }),
      getSchoolConfig(req.user.schoolId),
      prisma.schoolHoliday.findMany({ where: { schoolId: req.user.schoolId, date: { startsWith: month } } }),
      prisma.school.findUnique({ where: { id: req.user.schoolId }, select: { name: true } }),
    ]);

    const recordsByUser = new Map();
    for (const record of records) {
      const list = recordsByUser.get(record.userId) ?? [];
      list.push(attendanceToDto(record));
      recordsByUser.set(record.userId, list);
    }
    const holidayDates = new Set(holidays.map((h) => h.date));
    const today = istDateString(new Date());

    const teachers = users.map((u) => {
      const userRecords = recordsByUser.get(u.id) ?? [];
      const dates = config
        ? datesInMonth(month, today, sinceDateFor(config, u.createdAt))
        : userRecords.map((r) => r.date);
      return {
        name: u.name,
        email: u.email,
        summary: summarizeTeacherMonth(dates, userRecords, config ?? { weeklyOffDays: '' }, holidayDates),
      };
    });

    const buffer = await buildAttendanceReportWorkbook({ month, schoolName: school?.name ?? '', teachers });
    const filename = `${sanitizeFilenamePart(school?.name ?? 'school')}-${month}-attendance.xlsx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buffer));
  })
);

/**
 * One teacher's full day-by-day records for a month — the Reports
 * drill-down's detail fetch, split out from the list above so opening one
 * teacher never requires having loaded everyone else's daily detail too.
 * Registered after /school-history/export above so that literal path isn't
 * shadowed by this one's :userId param.
 */
router.get(
  '/teacher-attendance/school-history/:userId',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const month = req.query.month;
    if (!isValidMonth(month)) {
      return res.status(400).json({ error: 'month must be "YYYY-MM".' });
    }
    const teacher = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, name: true, email: true, schoolId: true, createdAt: true },
    });
    // Not-found and not-yours both 404, same convention as everywhere else
    // in this file.
    if (!teacher || teacher.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }
    const records = await prisma.teacherAttendance.findMany({
      where: { userId: teacher.id, date: { startsWith: month } },
      include: {
        _count: { select: { reviews: true } },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { reason: true } },
      },
      orderBy: { date: 'asc' },
    });
    res.json({
      month,
      teacher: { id: teacher.id, name: teacher.name, email: teacher.email, createdAt: teacher.createdAt },
      records: records.map((r) => attendanceToDetailDto(r)),
    });
  })
);

// ---- Corrections (Principal, on-demand) -----------------------------------------
//
// There is deliberately no review queue here anymore
// (docs/feature-teacher-attendance-implementation-plan.md §1.7/§4) — nothing
// auto-flags a day for approval, so there was nothing left to queue.
// Corrections are reachable from any day in the Reports drill-down
// (client/src/components/attendance/ReportsTab.tsx) instead of being gated
// behind queue membership; the action endpoint below never checked queue
// membership itself, so it's unchanged by that removal.

router.post(
  '/teacher-attendance/:id/review',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const parsed = reviewActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review action.' });
    }
    const record = await prisma.teacherAttendance.findUnique({ where: { id: req.params.id } });
    // Not-found and not-yours both 404, same convention as
    // classroom.js/resources.js — a Principal never learns another school's
    // record even exists.
    if (!record || record.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: 'Attendance record not found.' });
    }

    const { action, reason, correctedCheckInAt, correctedCheckOutAt, leaveOrDutyCategory } = parsed.data;
    const previousStatus = record.status;
    const updateData = {};

    if (action === 'approve') {
      updateData.status = 'present';
    } else if (action === 'reject') {
      updateData.status = 'absent';
    } else if (action === 'mark_on_leave') {
      updateData.status = 'on_leave';
      updateData.leaveOrDutyCategory = leaveOrDutyCategory;
    } else if (action === 'mark_on_duty') {
      updateData.status = 'on_duty';
      updateData.leaveOrDutyCategory = leaveOrDutyCategory;
    } else if (action === 'correct_checkin') {
      updateData.checkInAt = new Date(correctedCheckInAt);
      const config = await getSchoolConfig(req.user.schoolId);
      if (config) {
        // A corrected time is recorded the same way a normal check-in is —
        // present, with however many minutes late that implies — never a
        // flag, matching every other arrival everywhere else in this file
        // (decision §1.6). "Outside the window" no longer has a distinct
        // outcome once there's no queue for it to route into.
        const arrival = classifyArrival(updateData.checkInAt, config);
        updateData.lateMinutes = arrival.lateMinutes;
        updateData.status = 'present';
        if (record.checkOutAt) {
          const workingMinutes = computeWorkingMinutes(updateData.checkInAt, record.checkOutAt);
          const requiredMinutes = computeRequiredMinutes(config);
          const dayResult = deriveDayStatus(workingMinutes, requiredMinutes, config);
          updateData.workingMinutes = workingMinutes;
          updateData.shortfallMinutes = dayResult.shortfallMinutes;
          updateData.status = dayResult.dayStatus === 'half_day' ? 'half_day' : 'present';
        }
      }
    } else if (action === 'correct_checkout') {
      updateData.checkOutAt = new Date(correctedCheckOutAt);
      const config = await getSchoolConfig(req.user.schoolId);
      if (config && record.checkInAt) {
        const workingMinutes = computeWorkingMinutes(record.checkInAt, updateData.checkOutAt);
        const requiredMinutes = computeRequiredMinutes(config);
        const { earlyMinutes } = computeEarlyDeparture(updateData.checkOutAt, config);
        const dayResult = deriveDayStatus(workingMinutes, requiredMinutes, config);
        updateData.workingMinutes = workingMinutes;
        updateData.shortfallMinutes = dayResult.shortfallMinutes;
        updateData.earlyDepartureMinutes = earlyMinutes;
        updateData.status = dayResult.dayStatus === 'half_day' ? 'half_day' : 'present';
      }
    }

    // Append-only: the review row and the status change happen together, or
    // not at all — never a status change with no matching audit entry.
    // attendance-plan-review.md §11.
    const [review, updated] = await prisma.$transaction([
      prisma.teacherAttendanceReview.create({
        data: {
          attendanceId: record.id,
          reviewedByUserId: req.user.id,
          action,
          previousStatus,
          newStatus: updateData.status || previousStatus,
          reason,
        },
      }),
      prisma.teacherAttendance.update({ where: { id: record.id }, data: updateData }),
    ]);

    await logActivity({
      schoolId: req.user.schoolId,
      userId: record.userId,
      performedBy: req.user.id,
      action: action === 'mark_on_leave' || action === 'mark_on_duty' ? action : 'correction',
      result: `${action} on ${record.date} — ${previousStatus} → ${updateData.status || previousStatus}`,
      metadata: { attendanceId: record.id, action, reason },
    });

    res.json({
      // The review row was just created in the transaction above, not
      // re-fetched — feeding its reason in directly is simpler than a
      // second round trip just to reload the same relation.
      attendance: attendanceToDto({ ...updated, reviews: [{ reason }] }, { justReviewed: true }),
      review: { id: review.id, action: review.action },
    });
  })
);

// ---- School config -------------------------------------------------------------

// Readable by any authenticated teacher (not admin-only) — same "viewing
// isn't sensitive, only editing is" shape as the holidays routes below. A
// teacher needs their own school's weekly-off days and timings to make
// sense of their own History tab (attendance-plan-review.md's Absent
// computation needs it too — see client's HistoryTab.tsx).
router.get(
  '/teacher-attendance/school-config',
  ...gate,
  asyncHandler(async (req, res) => {
    const config = await getSchoolConfig(req.user.schoolId);
    res.json({ config });
  })
);

router.put(
  '/teacher-attendance/school-config',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const parsed = schoolAttendanceConfigSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid configuration.' });
    }
    const config = await prisma.schoolAttendanceConfig.upsert({
      where: { schoolId: req.user.schoolId },
      create: { schoolId: req.user.schoolId, ...parsed.data },
      update: parsed.data,
    });
    await logActivity({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      action: 'settings_changed',
      result: 'attendance settings updated',
      metadata: parsed.data,
    });
    res.json({ config });
  })
);

// ---- Holidays ---------------------------------------------------------------

router.get(
  '/teacher-attendance/holidays',
  ...gate,
  asyncHandler(async (req, res) => {
    const holidays = await prisma.schoolHoliday.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { date: 'asc' },
    });
    res.json({ holidays });
  })
);

router.post(
  '/teacher-attendance/holidays',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const parsed = createHolidaySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
    }
    try {
      const holiday = await prisma.schoolHoliday.create({
        data: { schoolId: req.user.schoolId, ...parsed.data },
      });
      await logActivity({
        schoolId: req.user.schoolId,
        userId: req.user.id,
        action: 'holiday_changed',
        result: `added ${holiday.date} — ${holiday.reason}`,
      });
      res.status(201).json({ holiday });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'A holiday already exists for that date.' });
      }
      throw err;
    }
  })
);

router.put(
  '/teacher-attendance/holidays/:id',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const parsed = createHolidaySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
    }
    const existing = await prisma.schoolHoliday.findUnique({ where: { id: req.params.id } });
    // Not-found and not-yours both 404, same convention as everywhere else
    // in this file — a Principal never learns another school's holiday even
    // exists.
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }
    try {
      const holiday = await prisma.schoolHoliday.update({ where: { id: req.params.id }, data: parsed.data });
      res.json({ holiday });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'A holiday already exists for that date.' });
      }
      throw err;
    }
  })
);

router.delete(
  '/teacher-attendance/holidays/:id',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const existing = await prisma.schoolHoliday.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }
    await prisma.schoolHoliday.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---- Activity log -----------------------------------------------------------

// Two kinds of event, genuinely different in how often a Principal cares
// about them: TEACHER_ACTIONS is a specific person's own day (check-ins,
// blocked attempts, reminders) — what this log exists for. ADMIN_ACTIONS
// (settings/holiday edits, corrections) are administrative housekeeping
// that can happen many times in a row while someone's mid-edit and would
// otherwise bury the actual teacher activity in between them. Split out so
// the client can filter by category instead of forcing one flat feed.
const TEACHER_ACTIONS = ['login', 'check_in', 'check_out', 'check_in_blocked', 'check_out_blocked', 'reminder_sent'];
const ADMIN_ACTIONS = ['correction', 'mark_on_leave', 'mark_on_duty', 'holiday_changed', 'settings_changed'];

/**
 * The "who → what → when → where → result" feed decision §1.10 requires.
 * Defaults to the last 7 days and never returns unbounded history — see
 * docs/feature-teacher-attendance-implementation-plan.md §7: this is the one
 * table with no natural ceiling, so it must never default to "everything."
 */
router.get(
  '/teacher-attendance/activity-log',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    let actionFilter;
    if (req.query.action) actionFilter = { action: String(req.query.action) };
    else if (req.query.category === 'teacher') actionFilter = { action: { in: TEACHER_ACTIONS } };
    else if (req.query.category === 'admin') actionFilter = { action: { in: ADMIN_ACTIONS } };

    const where = {
      schoolId: req.user.schoolId,
      createdAt: { gte: since },
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
      ...actionFilter,
      ...(search ? { user: { name: { contains: search } } } : {}),
    };

    const [total, entries] = await Promise.all([
      prisma.teacherAttendanceActivityLog.count({ where }),
      prisma.teacherAttendanceActivityLog.findMany({
        where,
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      days,
      page,
      pageSize,
      total,
      entries: entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.user?.name ?? null,
        performedBy: e.performedBy,
        action: e.action,
        result: e.result,
        distanceMeters: e.distanceMeters,
        createdAt: e.createdAt,
      })),
    });
  })
);

module.exports = router;
