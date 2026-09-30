// Classroom Management attendance math (docs/classroom-feature-plan.md). One implementation of the percentage
// formula and the "unmarked" derivation, used by every attendance route (day marking, summary, history, export,
// analytics), so the number can't drift between tabs and the exported CSV.
// "Unmarked" is never stored: a student with no AttendanceRecord for a date is unmarked, derived from
// (roster size - present - absent).

/**
 * attendance% = Present / (Present + Absent) * 100. Unmarked is excluded from both sides. Returns null
 * when nothing is marked yet, since present over zero is undefined, not 0%.
 * @param {number} present
 * @param {number} absent
 * @returns {number|null} rounded to one decimal place
 */
function attendancePercentage(present, absent) {
  const marked = present + absent;
  if (marked === 0) return null;
  return Math.round((present / marked) * 1000) / 10;
}

/**
 * Unmarked = roster size - (present + absent), clamped at 0 as a defensive floor.
 * @param {number} rosterSize
 * @param {number} present
 * @param {number} absent
 * @returns {number}
 */
function deriveUnmarked(rosterSize, present, absent) {
  return Math.max(0, rosterSize - present - absent);
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidMonth(value) {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** Parses "YYYY-MM-DD" into a UTC-midnight Date, or null if malformed. */
function parseDateParam(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** [start, end) UTC Date range covering every day in "YYYY-MM". */
function monthRange(month) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month "${month}"`);
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

function todayUtcDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "YYYY-MM" for the UTC calendar month containing `date`. */
function utcMonthString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Per-class, per-month attendance summary with a per-student breakdown; the single aggregation behind both
 * `attendance/summary` and `attendance/export`, so their numbers match.
 * "Days marked" is the distinct days in the month with at least one record for the class, and Unmarked
 * figures are derived against it from the live roster (active students only), so nothing needs backfilling.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{classId: string, teacherId: string, month: string}} params
 */
async function computeClassAttendanceMonthSummary(prisma, { classId, teacherId, month }) {
  const { start, end } = monthRange(month);
  const [students, records] = await Promise.all([
    prisma.student.findMany({ where: { classId, teacherId, active: true }, orderBy: { name: 'asc' } }),
    prisma.attendanceRecord.findMany({ where: { classId, teacherId, date: { gte: start, lt: end } } }),
  ]);

  const daysMarked = new Set(records.map((r) => dateKey(r.date))).size;

  const perStudentMap = new Map(
    students.map((s) => [s.id, { studentId: s.id, name: s.name, rollNumber: s.rollNumber, present: 0, absent: 0 }])
  );
  for (const r of records) {
    // A record whose student is no longer active is excluded from the live-roster view.
    const entry = perStudentMap.get(r.studentId);
    if (!entry) continue;
    if (r.status === 'present') entry.present += 1;
    else if (r.status === 'absent') entry.absent += 1;
  }

  const perStudent = [...perStudentMap.values()].map((e) => ({
    ...e,
    unmarked: deriveUnmarked(daysMarked, e.present, e.absent),
    percentage: attendancePercentage(e.present, e.absent),
  }));

  const present = perStudent.reduce((sum, e) => sum + e.present, 0);
  const absent = perStudent.reduce((sum, e) => sum + e.absent, 0);

  return {
    month,
    totalStudents: students.length,
    daysMarked,
    present,
    absent,
    unmarked: deriveUnmarked(students.length * daysMarked, present, absent),
    percentage: attendancePercentage(present, absent),
    perStudent,
  };
}

/**
 * Day-by-day breakdown for one class and month. Only days with at least one mark appear.
 */
async function getClassAttendanceHistory(prisma, { classId, teacherId, month }) {
  const { start, end } = monthRange(month);
  const [rosterSize, records] = await Promise.all([
    prisma.student.count({ where: { classId, teacherId, active: true } }),
    prisma.attendanceRecord.findMany({ where: { classId, teacherId, date: { gte: start, lt: end } }, orderBy: { date: 'asc' } }),
  ]);

  const byDate = new Map();
  for (const r of records) {
    const key = dateKey(r.date);
    if (!byDate.has(key)) byDate.set(key, { present: 0, absent: 0 });
    const bucket = byDate.get(key);
    if (r.status === 'present') bucket.present += 1;
    else if (r.status === 'absent') bucket.absent += 1;
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { present, absent }]) => ({
      date,
      present,
      absent,
      unmarked: deriveUnmarked(rosterSize, present, absent),
      percentage: attendancePercentage(present, absent),
    }));
}

/**
 * Raw per-date records for one student in a month, for the day-by-day list in the history view. The
 * numbers come from computeClassAttendanceMonthSummary's `perStudent` entry, never recomputed here.
 */
async function getStudentAttendanceDates(prisma, { studentId, teacherId, month }) {
  const { start, end } = monthRange(month);
  const records = await prisma.attendanceRecord.findMany({
    where: { studentId, teacherId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  });
  return records.map((r) => ({ date: dateKey(r.date), status: r.status }));
}

/** Today's attendance across every one of a teacher's classes (Analytics). */
async function getTeacherAttendanceToday(prisma, { teacherId, date }) {
  const [totalStudents, records] = await Promise.all([
    prisma.student.count({ where: { teacherId, active: true } }),
    prisma.attendanceRecord.findMany({ where: { teacherId, date } }),
  ]);
  let present = 0;
  let absent = 0;
  for (const r of records) {
    if (r.status === 'present') present += 1;
    else if (r.status === 'absent') absent += 1;
  }
  return {
    totalStudents,
    present,
    absent,
    unmarked: deriveUnmarked(totalStudents, present, absent),
    percentage: attendancePercentage(present, absent),
  };
}

/** Current-month attendance across every one of a teacher's classes (Analytics). */
async function getTeacherAttendanceMonth(prisma, { teacherId, month }) {
  const { start, end } = monthRange(month);
  const [totalStudents, records] = await Promise.all([
    prisma.student.count({ where: { teacherId, active: true } }),
    prisma.attendanceRecord.findMany({ where: { teacherId, date: { gte: start, lt: end } } }),
  ]);
  const daysMarked = new Set(records.map((r) => dateKey(r.date))).size;
  let present = 0;
  let absent = 0;
  for (const r of records) {
    if (r.status === 'present') present += 1;
    else if (r.status === 'absent') absent += 1;
  }
  return {
    month,
    totalStudents,
    daysMarked,
    present,
    absent,
    unmarked: deriveUnmarked(totalStudents * daysMarked, present, absent),
    percentage: attendancePercentage(present, absent),
  };
}

module.exports = {
  attendancePercentage,
  deriveUnmarked,
  isValidMonth,
  parseDateParam,
  monthRange,
  todayUtcDateOnly,
  utcMonthString,
  computeClassAttendanceMonthSummary,
  getClassAttendanceHistory,
  getStudentAttendanceDates,
  getTeacherAttendanceToday,
  getTeacherAttendanceMonth,
};
