// Writes one TeacherAttendanceActivityLog row (who did what, when, where, with what result; see
// docs/feature-teacher-attendance-implementation-plan.md). In lib/ because routes/auth.js needs it for the login event too.
const { prisma } = require('./db');

/**
 * Best-effort: a logging failure must never cost the teacher an already-saved attendance action.
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
