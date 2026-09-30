// Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md): a teacher's own check-in and
// check-out, reviewed by their school's Principal (school_admin). Not routes/classroom.js's student attendance.
// The client sends only raw evidence (lat/lon/accuracy/device id), never a verdict, and the server recomputes
// geofence distance and status via lib/teacherAttendance.js. checkInSchema/checkOutSchema have no field for a
// client-supplied "inside: true" for that reason.
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
 * Same rollout predicate as routes/classroom.js's isWithinClassroomRollout: `enabled` is the gate and
 * `allowedSchoolCodes` a filter on top (empty means every school).
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
 * Gate middleware, like routes/classroom.js's requireClassroomManagementEnabled: flags are read live and applied
 * per route, since this router mounts at the bare "/api" and self-prefixes "/teacher-attendance/..." (see index.js).
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

// DTOs

/**
 * A teacher's own view of one day; raw GPS and device id are omitted. `record._count.reviews` (from the query's
 * `include`) tells deriveEffectiveStatus whether a Principal already resolved a missing-checkout day. A caller that
 * just created a review can pass `{ justReviewed: true }` instead of re-querying.
 * `reviewReason` is the Principal's typed reason from the latest TeacherAttendanceReview (when `reviews` was loaded),
 * so a teacher can see why a day was resolved; null if never reviewed or not loaded.
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
 * Is `now` a day the school expects no check-in at all (weekly off day or declared holiday)? Checked before
 * check-in can start.
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

// Check-in / check-out

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

    // Too far or outside the check-in window is a hard block, not a flagged record. Nothing is written to
    // TeacherAttendance for a blocked attempt, only a log entry.
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

    // Checkout has no time-of-day gate, unlike check-in (upper bound checkinWindowEnd): a teacher at school can leave
    // whenever, and only location can block it. earlyDepartureMinutes is still recorded for Reports/History.
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

    // A short day, even an implausibly short one, is recorded as Half Day with the real shortfallMinutes, never
    // escalated to a Principal review. It's a fact, not a violation.
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

// Own view

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
 * Today's counts across the school, the Principal's headline on the Reports tab (docs/attendance-register-design.html):
 * four numbers, not a table. `absent` is roster size minus anyone with a record today, deliberately simpler than the
 * month view's "filled-in calendar" absence logic.
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

// Whole-school report (Principal)

/**
 * Every teacher's summary for one school and month, paginated; the Reports table. Summary only, since sending
 * every teacher's full month doesn't scale (docs/feature-teacher-attendance-implementation-plan.md). Day-by-day detail is the call below.
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
 * One teacher's day-by-day records for a month, the Reports drill-down. Registered after /school-history/export so
 * that literal path isn't shadowed by :userId.
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

// Corrections (Principal, on-demand)
// There is no review queue: nothing auto-flags a day for approval. Corrections are reachable from any day in the
// Reports drill-down (client/src/components/attendance/ReportsTab.tsx), and the action endpoint never checked queue membership.

router.post(
  '/teacher-attendance/:id/review',
  ...adminGate,
  asyncHandler(async (req, res) => {
    const parsed = reviewActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review action.' });
    }
    const record = await prisma.teacherAttendance.findUnique({ where: { id: req.params.id } });
    // Missing and other-school's records both 404, so a Principal never learns another school's record exists.
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
        // A corrected time is recorded like a normal check-in: present, with the resulting late minutes, never a flag.
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

    // Append-only: the review row and the status change happen together or not at all, so there's never a status change without an audit entry.
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
      // The review row was just created in the transaction above; its reason is used directly rather than re-fetched.
      attendance: attendanceToDto({ ...updated, reviews: [{ reason }] }, { justReviewed: true }),
      review: { id: review.id, action: review.action },
    });
  })
);

// School config

// Readable by any authenticated teacher: viewing isn't sensitive, only editing is (as with holidays). A teacher needs
// their school's weekly-off days and timings to make sense of their History tab.
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

// Holidays

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
    // Missing and other-school's holidays both 404, so a Principal never learns another school's holiday exists.
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

// Activity log

// Two kinds of event. TEACHER_ACTIONS are a person's own day (check-ins, blocked attempts, reminders), which is what
// this log is for. ADMIN_ACTIONS (settings, holiday edits, corrections) can repeat while someone is mid-edit and
// would bury the teacher activity, so the client can filter by category.
const TEACHER_ACTIONS = ['login', 'check_in', 'check_out', 'check_in_blocked', 'check_out_blocked', 'reminder_sent'];
const ADMIN_ACTIONS = ['correction', 'mark_on_leave', 'mark_on_duty', 'holiday_changed', 'settings_changed'];

/**
 * The "who, what, when, where, result" feed. Defaults to the last 7 days and never returns unbounded history: this
 * table has no natural ceiling (docs/feature-teacher-attendance-implementation-plan.md).
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
