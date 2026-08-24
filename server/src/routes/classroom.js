// Classroom Management — see docs/classroom-feature-plan.md.
//
// A teacher-first workspace: My Classes / Students / Attendance / Fees /
// Reports. SCOPE, stated so it is not widened by accident: every route in
// this file filters strictly on `teacherId: req.user.id` (never schoolId,
// never the request body) — a teacher only ever sees/manages THEIR OWN
// classes, students, attendance, and fee data, regardless of role. There is
// no school_admin/resource_person cross-teacher visibility in V1; see
// test/classroom-tenant-isolation.test.js for the assertions that pin this.
//
// NOT to be confused with the unrelated "Classroom Mode" AI chat feature
// (routes mounted separately, see index.js's classroomPlanPromise/
// CLASSROOM_MODE_ENABLED) — that feature has no classes, students,
// attendance, or fees, and this file never touches it.
//
// Ownership pattern mirrors routes/resources.js exactly: a lookup that
// doesn't match the caller 404s (never 403s), so existence is never leaked
// across teachers.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readClassroomManagementFlags, readNotificationsFlags } = require('../lib/flags');
const { toCsv } = require('../lib/csv');
const { createNotification } = require('../lib/notificationService');
const {
  attendancePercentage,
  deriveUnmarked,
  isValidMonth,
  parseDateParam,
  todayUtcDateOnly,
  utcMonthString,
  computeClassAttendanceMonthSummary,
  getClassAttendanceHistory,
  getStudentAttendanceDates,
  getTeacherAttendanceToday,
  getTeacherAttendanceMonth,
} = require('../lib/classroomAttendance');
const { deriveFeeStatus, getClassFeeStatus, getTeacherFeeCounts } = require('../lib/classroomFees');
const { buildFeeReportWorkbook } = require('../lib/feeReportExcel');

const router = express.Router();

const MAX_NAME = 200;
const MAX_META = 60; // grade / section / roll number
// Generous ceiling for one bulk attendance save — well above any pilot-scale
// class size, while still comfortably fitting the app's default 16kb JSON
// body limit (index.js does not special-case /api/classroom the way it does
// /api/resources, so this stays under that shared limit rather than
// requesting a larger one).
const MAX_MARKS_PER_REQUEST = 120;
const ATTENDANCE_STATUSES = ['present', 'absent', 'unmarked'];
// A generous ceiling for a monthly class/student fee, in whole rupees — well
// above any real school fee, just guarding against a fat-fingered/garbage
// value (docs/fee-tracking-amounts-plan.md).
const MAX_FEE_AMOUNT = 1000000;

/**
 * Same rollout predicate shape as routes/attachments.js's isWithinRollout:
 * `enabled` is the gate, `allowedSchoolCodes` is a FILTER on top of it (empty
 * means every school — see readClassroomManagementFlags). Kept local rather
 * than shared, same reasoning as attachments.js's own copy — different
 * feature, different failure semantics, not worth a shared abstraction for a
 * five-line predicate.
 */
async function isWithinClassroomRollout(user, flags) {
  if (!flags.enabled) return false;
  if (flags.allowedSchoolCodes.length === 0) return true;
  try {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
    return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
  } catch {
    return false; // fails closed, same reasoning as attachments.js/assistant.js
  }
}

/**
 * Gate middleware — same shape as routes/notifications.js's
 * requireNotificationsEnabled: flags are read LIVE (process.env), not cached
 * at boot, so the server's kill switch takes effect immediately and a test
 * suite can toggle it per-file. Applied per-route (below), NOT as a
 * router-wide `router.use()` — this router is mounted at the bare `/api`
 * (its own routes self-prefix with `/classroom/...`, see index.js's comment
 * on the mount), so a router-wide `.use()` with no path filter would run for
 * ANY path Express hands to this router, including ones that don't match any
 * route here. A disabled/out-of-rollout gate returning 503 without calling
 * next() would then swallow those unmatched paths — e.g.
 * `/api/assistant/not-a-real-endpoint`, which falls through every earlier
 * `/api`-mounted router before reaching this one — turning them into a 503
 * instead of letting Express's normal 404 fallback run. Every other flagged
 * router in this codebase (`notifications.js` included) applies its gate
 * per-route for exactly this reason; this router now matches that pattern.
 */
function requireClassroomManagementEnabled() {
  return asyncHandler(async (req, res, next) => {
    const flags = readClassroomManagementFlags(process.env);
    if (!(await isWithinClassroomRollout(req.user, flags))) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'CLASSROOM_MANAGEMENT_DISABLED' });
    }
    return next();
  });
}

const gate = [authRequired, requireClassroomManagementEnabled()];

// ---- Ownership helpers -----------------------------------------------------
// Mirrors resources.js's findOwned(): returns null for "does not exist" AND
// "belongs to someone else" alike, so callers always 404 without leaking
// which case it was.

async function findOwnedClass(classId, teacherId) {
  const cls = await prisma.schoolClass.findUnique({ where: { id: classId } });
  if (!cls || cls.teacherId !== teacherId) return null;
  return cls;
}

async function findOwnedStudent(studentId, teacherId) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.teacherId !== teacherId) return null;
  return student;
}

function sanitizeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'export';
}

// ---- DTOs -------------------------------------------------------------------

function classToDto(c) {
  return {
    id: c.id,
    name: c.name,
    grade: c.grade,
    section: c.section,
    feeAmount: c.feeAmount,
    archived: c.archived,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function studentToDto(s) {
  return {
    id: s.id,
    classId: s.classId,
    name: s.name,
    rollNumber: s.rollNumber,
    active: s.active,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function feeToDto(f) {
  return {
    id: f.id,
    studentId: f.studentId,
    classId: f.classId,
    period: f.period,
    status: f.status,
    amount: f.amount || 0,
    expectedAmount: f.expectedAmount,
    updatedAt: f.updatedAt,
  };
}

// ---- My Classes -------------------------------------------------------------

const createClassSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    grade: z.string().trim().max(MAX_META).optional(),
    section: z.string().trim().max(MAX_META).optional(),
    feeAmount: z.number().int().min(0).max(MAX_FEE_AMOUNT).optional(),
  })
  .strict();

const updateClassSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME).optional(),
    grade: z.string().trim().max(MAX_META).optional(),
    section: z.string().trim().max(MAX_META).optional(),
    // null explicitly clears a previously-set fee amount (the client can't
    // send "" to mean "cleared" the way it does for grade/section — an
    // empty number input has no valid numeric fallback — so null is the
    // clear signal instead).
    feeAmount: z.number().int().min(0).max(MAX_FEE_AMOUNT).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update.' });

// GET /api/classroom/classes — the caller's own classes. Archived classes are
// excluded by default (they're done, not deleted); ?includeArchived=true
// includes them, e.g. to review a past term's history.
router.get('/classroom/classes', ...gate, asyncHandler(async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const where = { teacherId: req.user.id };
  if (!includeArchived) where.archived = false;
  const classes = await prisma.schoolClass.findMany({ where, orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }] });
  res.json({ classes: classes.map(classToDto) });
}));

router.post('/classroom/classes', ...gate, asyncHandler(async (req, res) => {
  const parsed = createClassSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid class.' });
  }
  const created = await prisma.schoolClass.create({
    // Ownership from the token — never the client. schoolId is denormalized
    // for a possible future rollup (§19) but plays no part in any access
    // check anywhere in this file.
    data: { teacherId: req.user.id, schoolId: req.user.schoolId, ...parsed.data },
  });
  res.status(201).json({ class: classToDto(created) });
}));

router.get('/classroom/classes/:classId', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  res.json({ class: classToDto(cls) });
}));

router.patch('/classroom/classes/:classId', ...gate, asyncHandler(async (req, res) => {
  const parsed = updateClassSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update.' });
  }
  const existing = await findOwnedClass(req.params.classId, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Class not found.' });
  const updated = await prisma.schoolClass.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ class: classToDto(updated) });
}));

// DELETE always soft-deletes (archived: true) — a class's attendance/fee
// history is never hard-deleted (schema.prisma's own doc comment on
// SchoolClass.archived). Idempotent: archiving an already-archived class is
// still a 200, not an error.
router.delete('/classroom/classes/:classId', ...gate, asyncHandler(async (req, res) => {
  const existing = await findOwnedClass(req.params.classId, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Class not found.' });
  const updated = await prisma.schoolClass.update({ where: { id: existing.id }, data: { archived: true } });
  res.json({ class: classToDto(updated) });
}));

// ---- Students -----------------------------------------------------------

const createStudentSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    rollNumber: z.string().trim().max(MAX_META).optional(),
  })
  .strict();

const updateStudentSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME).optional(),
    rollNumber: z.string().trim().max(MAX_META).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update.' });

router.get('/classroom/classes/:classId/students', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  const includeInactive = req.query.includeInactive === 'true';
  const where = { classId: cls.id };
  if (!includeInactive) where.active = true;
  const students = await prisma.student.findMany({ where, orderBy: { name: 'asc' } });
  res.json({ students: students.map(studentToDto) });
}));

router.post('/classroom/classes/:classId/students', ...gate, asyncHandler(async (req, res) => {
  const parsed = createStudentSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid student.' });
  }
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (cls.archived) {
    return res.status(400).json({ error: 'Cannot add students to an archived class.' });
  }
  const created = await prisma.student.create({
    data: { classId: cls.id, teacherId: req.user.id, ...parsed.data },
  });
  res.status(201).json({ student: studentToDto(created) });
}));

router.patch('/classroom/students/:studentId', ...gate, asyncHandler(async (req, res) => {
  const parsed = updateStudentSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update.' });
  }
  const existing = await findOwnedStudent(req.params.studentId, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Student not found.' });
  const updated = await prisma.student.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ student: studentToDto(updated) });
}));

// Soft-delete (active: false) — preserves attendance/fee history exactly
// like archiving a class does. Idempotent.
router.delete('/classroom/students/:studentId', ...gate, asyncHandler(async (req, res) => {
  const existing = await findOwnedStudent(req.params.studentId, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Student not found.' });
  const updated = await prisma.student.update({ where: { id: existing.id }, data: { active: false } });
  res.json({ student: studentToDto(updated) });
}));

// ---- Attendance -----------------------------------------------------------

const markAttendanceSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    marks: z
      .array(
        z
          .object({
            studentId: z.string().trim().min(1),
            // "unmarked" is a legal value here even though it's never stored
            // — sending it deletes that student's row for the date (§10's
            // "moving a student back to Unmarked").
            status: z.enum(ATTENDANCE_STATUSES),
          })
          .strict()
      )
      .min(1)
      .max(MAX_MARKS_PER_REQUEST),
  })
  .strict();

// GET one day's roster + marks (three-state: present/absent/unmarked).
router.get('/classroom/classes/:classId/attendance', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  const date = parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: 'A valid "date" query param (YYYY-MM-DD) is required.' });

  const [students, records] = await Promise.all([
    prisma.student.findMany({ where: { classId: cls.id, active: true }, orderBy: { name: 'asc' } }),
    prisma.attendanceRecord.findMany({ where: { classId: cls.id, date } }),
  ]);
  const byStudent = new Map(records.map((r) => [r.studentId, r.status]));
  const roster = students.map((s) => ({
    studentId: s.id,
    name: s.name,
    rollNumber: s.rollNumber,
    status: byStudent.get(s.id) || 'unmarked',
  }));
  const present = roster.filter((r) => r.status === 'present').length;
  const absent = roster.filter((r) => r.status === 'absent').length;

  res.json({
    date: req.query.date,
    roster,
    summary: {
      present,
      absent,
      unmarked: deriveUnmarked(roster.length, present, absent),
      percentage: attendancePercentage(present, absent),
    },
  });
}));

// POST bulk upsert for one date — see §7/§14: any student in the batch that
// doesn't belong to this teacher's class rejects the WHOLE batch (400), never
// a partial save.
router.post('/classroom/classes/:classId/attendance', ...gate, asyncHandler(async (req, res) => {
  const parsed = markAttendanceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid attendance payload.' });
  }
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });

  const date = parseDateParam(parsed.data.date);
  const { marks } = parsed.data;
  const studentIds = [...new Set(marks.map((m) => m.studentId))];
  const owned = await prisma.student.findMany({
    where: { id: { in: studentIds }, classId: cls.id, teacherId: req.user.id },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((s) => s.id));
  const hasUnowned = studentIds.some((id) => !ownedIds.has(id));
  if (hasUnowned) {
    return res.status(400).json({ error: 'One or more students in this request do not belong to this class.' });
  }

  await prisma.$transaction(
    marks.map((mark) => {
      if (mark.status === 'unmarked') {
        return prisma.attendanceRecord.deleteMany({ where: { studentId: mark.studentId, date } });
      }
      return prisma.attendanceRecord.upsert({
        where: { studentId_date: { studentId: mark.studentId, date } },
        create: { studentId: mark.studentId, teacherId: req.user.id, classId: cls.id, date, status: mark.status },
        update: { status: mark.status, markedAt: new Date() },
      });
    })
  );

  res.json({ date: parsed.data.date, saved: marks.length });
}));

router.get('/classroom/classes/:classId/attendance/summary', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (!isValidMonth(req.query.month)) {
    return res.status(400).json({ error: 'A valid "month" query param (YYYY-MM) is required.' });
  }
  const summary = await computeClassAttendanceMonthSummary(prisma, {
    classId: cls.id,
    teacherId: req.user.id,
    month: req.query.month,
  });
  res.json(summary);
}));

router.get('/classroom/classes/:classId/attendance/history', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (!isValidMonth(req.query.month)) {
    return res.status(400).json({ error: 'A valid "month" query param (YYYY-MM) is required.' });
  }
  const days = await getClassAttendanceHistory(prisma, {
    classId: cls.id,
    teacherId: req.user.id,
    month: req.query.month,
  });
  res.json({ month: req.query.month, days });
}));

// GET .../attendance/export?month= — CSV download (§13). Requires class +
// month, matching the "no unscoped export" requirement. Computed by the same
// helper attendance/summary uses, so the CSV can never disagree with the
// on-screen numbers.
router.get('/classroom/classes/:classId/attendance/export', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (!isValidMonth(req.query.month)) {
    return res.status(400).json({ error: 'A valid "month" query param (YYYY-MM) is required.' });
  }
  const month = req.query.month;
  const summary = await computeClassAttendanceMonthSummary(prisma, { classId: cls.id, teacherId: req.user.id, month });

  const header = ['Student Name', 'Roll Number', 'Present', 'Absent', 'Unmarked', 'Attendance %'];
  const rows = summary.perStudent.map((s) => [
    s.name,
    s.rollNumber || '',
    s.present,
    s.absent,
    s.unmarked,
    s.percentage === null ? '' : s.percentage,
  ]);
  rows.push([
    'TOTAL',
    '',
    summary.present,
    summary.absent,
    summary.unmarked,
    summary.percentage === null ? '' : summary.percentage,
  ]);

  const csv = toCsv(header, rows);
  const filename = `${sanitizeFilenamePart(cls.name)}-${month}-attendance.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}));

// GET one student's day-by-day history for a month (Phase 3 UI's "Student
// Attendance History"). present/absent are tallied straight from `days`
// (this student's own records — correct even for a deactivated student, who
// computeClassAttendanceMonthSummary's active-only perStudent would silently
// drop), then run through the SAME attendancePercentage/deriveUnmarked calls
// every other attendance view uses (§10) — never a reimplementation of that
// math. `daysMarked` (the denominator for "unmarked") is the class's own
// count of marked days, also class-wide and not active-filtered, so it lines
// up with the summary/export views for the same class + month.
router.get('/classroom/students/:studentId/attendance/history', ...gate, asyncHandler(async (req, res) => {
  const student = await findOwnedStudent(req.params.studentId, req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (!isValidMonth(req.query.month)) {
    return res.status(400).json({ error: 'A valid "month" query param (YYYY-MM) is required.' });
  }
  const month = req.query.month;

  const [summary, days] = await Promise.all([
    computeClassAttendanceMonthSummary(prisma, { classId: student.classId, teacherId: req.user.id, month }),
    getStudentAttendanceDates(prisma, { studentId: student.id, teacherId: req.user.id, month }),
  ]);
  const present = days.filter((d) => d.status === 'present').length;
  const absent = days.filter((d) => d.status === 'absent').length;

  res.json({
    studentId: student.id,
    name: student.name,
    rollNumber: student.rollNumber,
    month,
    present,
    absent,
    unmarked: deriveUnmarked(summary.daysMarked, present, absent),
    percentage: attendancePercentage(present, absent),
    days,
  });
}));

// ---- Fees -------------------------------------------------------------------

// The client sends the amount actually paid so far this period — `status`
// (paid/partial/pending) is always DERIVED server-side (classroomFees.js's
// deriveFeeStatus), never accepted from the client, so a teacher can never
// desync the two (docs/fee-tracking-amounts-plan.md).
const updateFeeSchema = z.object({ amount: z.number().int().min(0).max(MAX_FEE_AMOUNT) }).strict();

router.get('/classroom/classes/:classId/fees', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (!isValidMonth(req.query.period)) {
    return res.status(400).json({ error: 'A valid "period" query param (YYYY-MM) is required.' });
  }
  const status = await getClassFeeStatus(prisma, { classId: cls.id, teacherId: req.user.id, period: req.query.period });
  res.json(status);
}));

router.patch('/classroom/students/:studentId/fees/:period', ...gate, asyncHandler(async (req, res) => {
  if (!isValidMonth(req.params.period)) {
    return res.status(400).json({ error: 'Invalid period.' });
  }
  const parsed = updateFeeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid fee update.' });
  }
  const student = await findOwnedStudent(req.params.studentId, req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const cls = await findOwnedClass(student.classId, req.user.id);
  const { amount } = parsed.data;
  const paidAt = amount > 0 ? new Date() : null;

  const existing = await prisma.feeRecord.findUnique({
    where: { studentId_period: { studentId: student.id, period: req.params.period } },
  });
  // expectedAmount is a one-time snapshot of the class's CURRENT feeAmount,
  // taken only when this period's row doesn't exist yet — see
  // SchoolClass.feeAmount's doc comment. An existing row keeps whatever
  // snapshot it already has, even if the class's feeAmount has since changed.
  const expectedAmount = existing ? existing.expectedAmount : cls?.feeAmount ?? null;
  const status = deriveFeeStatus(amount, expectedAmount);

  const record = await prisma.feeRecord.upsert({
    where: { studentId_period: { studentId: student.id, period: req.params.period } },
    create: {
      studentId: student.id,
      teacherId: req.user.id,
      classId: student.classId,
      period: req.params.period,
      amount,
      expectedAmount,
      status,
      paidAt,
    },
    update: { amount, status, paidAt },
  });

  // System-generated reminder: "N students still pending fees this month",
  // linking to this class's Reports tab (docs/fee-tracking-amounts-plan.md
  // Step 3). Best-effort and non-blocking — a failure here must never cost
  // the teacher the payment they just recorded — same pattern as
  // routes/resources.js's "resource saved" notification hook. There's no
  // scheduled-job runner in this app (see plan doc), so this fires the
  // first time a teacher records ANY payment for a class+period, not on a
  // recurring schedule; deduped so it never re-fires for the same
  // class+period once sent.
  try {
    if (cls && readNotificationsFlags(process.env).enabled) {
      const feeStatus = await getClassFeeStatus(prisma, { classId: cls.id, teacherId: req.user.id, period: req.params.period });
      const owing = feeStatus.partial + feeStatus.pending;
      if (owing > 0) {
        const link = `/classroom?tab=reports&class=${cls.id}&period=${req.params.period}`;
        const already = await prisma.notification.findFirst({
          where: { recipientId: req.user.id, type: 'reminder', link },
        });
        if (!already) {
          await createNotification(
            {
              recipientId: req.user.id,
              type: 'reminder',
              title: 'Fees still pending',
              message: `${owing} student${owing === 1 ? '' : 's'} still owe fees for ${req.params.period} in "${cls.name}".`,
              link,
              metadata: { classId: cls.id, period: req.params.period },
            },
            req.app.locals.socketServer
          );
        }
      }
    }
  } catch (notifyError) {
    console.error('[notifications] fee_pending_reminder_failed', { message: notifyError.message });
  }

  res.json({ fee: feeToDto(record) });
}));

// GET .../fees/export?period= — Excel (.xlsx) download (§13), including
// real ₹ amounts AND the same Paid/Partial/Pending cell coloring the
// Fees/Reports tabs show on screen — a plain CSV can't carry color at all,
// so this is a real spreadsheet file, not text (docs/fee-tracking-amounts-plan.md).
router.get('/classroom/classes/:classId/fees/export', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  if (!isValidMonth(req.query.period)) {
    return res.status(400).json({ error: 'A valid "period" query param (YYYY-MM) is required.' });
  }
  const period = req.query.period;
  const status = await getClassFeeStatus(prisma, { classId: cls.id, teacherId: req.user.id, period });

  const buffer = await buildFeeReportWorkbook({ ...status, className: cls.name });
  const filename = `${sanitizeFilenamePart(cls.name)}-${period}-fees.xlsx`;
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(Buffer.from(buffer));
}));

// ---- Analytics --------------------------------------------------------------

router.get('/classroom/analytics/overview', ...gate, asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const today = todayUtcDateOnly();
  const month = utcMonthString(today);

  const [totalStudents, todayAttendance, monthAttendance, fees] = await Promise.all([
    prisma.student.count({ where: { teacherId, active: true } }),
    getTeacherAttendanceToday(prisma, { teacherId, date: today }),
    getTeacherAttendanceMonth(prisma, { teacherId, month }),
    getTeacherFeeCounts(prisma, { teacherId, period: month }),
  ]);

  res.json({ totalStudents, today: todayAttendance, month: monthAttendance, fees });
}));

router.get('/classroom/analytics/classes/:classId', ...gate, asyncHandler(async (req, res) => {
  const cls = await findOwnedClass(req.params.classId, req.user.id);
  if (!cls) return res.status(404).json({ error: 'Class not found.' });
  const today = todayUtcDateOnly();
  const month = utcMonthString(today);

  const [totalStudents, monthAttendance, feeStatus] = await Promise.all([
    prisma.student.count({ where: { classId: cls.id, active: true } }),
    computeClassAttendanceMonthSummary(prisma, { classId: cls.id, teacherId: req.user.id, month }),
    getClassFeeStatus(prisma, { classId: cls.id, teacherId: req.user.id, period: month }),
  ]);

  res.json({
    classId: cls.id,
    totalStudents,
    month: monthAttendance,
    fees: {
      period: month,
      totalStudents: feeStatus.totalStudents,
      paid: feeStatus.paid,
      partial: feeStatus.partial,
      pending: feeStatus.pending,
      totalCollected: feeStatus.totalCollected,
      totalExpected: feeStatus.totalExpected,
    },
  });
}));

module.exports = router;
