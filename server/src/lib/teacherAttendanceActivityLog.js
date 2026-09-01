// Writes one row to TeacherAttendanceActivityLog — the "who did what, when,
// where, with what result" record decision §1.10 in
// docs/feature-teacher-attendance-implementation-plan.md requires. Pulled
// out of routes/teacherAttendance.js into its own lib file (rather than one
// route file importing from another) since routes/auth.js also needs it for
// the login event — the same reasoning this codebase already applies
// everywhere shared logic lives in lib/, not cross-imported between routes.
const { prisma } = require('./db');

/**
 * Best-effort: a logging failure must never cost the teacher their
 * already-saved attendance action, same "never let a side-effect write
 * block the primary one" convention the old admin-notification hook this
 * replaces used to follow.
 * @param {{schoolId: string, userId: string, performedBy?: string, action: string, result?: string, lat?: number, lon?: number, distanceMeters?: number, metadata?: object}} entry
 */
async function logTeacherAttendanceActivity(entry) {
  try {
    await prisma.teacherAttendanceActivityLog.create({
      data: {
        schoolId: entry.schoolId,
        userId: entry.userId,
        performedBy: entry.performedBy ?? null,
        action: entry.action,
        result: entry.result ?? null,
        lat: entry.lat ?? null,
        lon: entry.lon ?? null,
        distanceMeters: entry.distanceMeters ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (err) {
    console.error('[teacher-attendance] activity log write failed', { action: entry.action, message: err.message });
  }
}

module.exports = { logTeacherAttendanceActivity };
