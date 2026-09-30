// Checkout reminder sweep (docs/feature-teacher-attendance-implementation-plan.md): "don't forget to check out",
// stopping once the teacher checks out, at a reasonable interval.
// The before/after window is a per-school setting (SchoolAttendanceConfig.reminderMinutesBeforeClose/AfterClose);
// DEFAULT_REMINDER_MINUTES_BEFORE_CLOSE/AFTER_CLOSE below are only the Prisma column defaults.
// The app has no scheduler and runs one Node process, so a plain setInterval (wired in index.js, only when the
// server actually starts, not under test) beats a job-queue dependency for one recurring check.
const { prisma } = require('./db');
const { readTeacherAttendanceFlags, readNotificationsFlags } = require('./flags');
const { createNotification } = require('./notificationService');
const { logTeacherAttendanceActivity } = require('./teacherAttendanceActivityLog');
const { istDateString, timeStringToMinutes, utcDateToIstMinutesOfDay } = require('./teacherAttendance');

const DEFAULT_REMINDER_MINUTES_BEFORE_CLOSE = 15;
const DEFAULT_REMINDER_MINUTES_AFTER_CLOSE = 30;
// How often index.js's setInterval calls the sweep below — a few minutes
// apart, not every minute.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The UTC instant of IST midnight on a "YYYY-MM-DD" date — the floor for "already reminded today." */
function istMidnightUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - (5 * 60 + 30) * 60000);
}

/**
 * Runs one sweep across every school: for each school inside its reminder window, reminds every teacher who
 * checked in today but hasn't checked out, once per teacher per day. "Already reminded" is read from the
 * activity log rather than a new column, so the state can't drift.
 * @param {Date} [now]
 * @param {{ emitToUser: (userId: string, event: string, payload: unknown) => void }|null} [socketServer]
 */
async function runCheckoutReminderSweep(now = new Date(), socketServer = null) {
  if (!readTeacherAttendanceFlags(process.env).enabled) return;
  if (!readNotificationsFlags(process.env).enabled) return;

  const nowMinutes = utcDateToIstMinutesOfDay(now);
  const today = istDateString(now);
  const todayStart = istMidnightUtc(today);

  const configs = await prisma.schoolAttendanceConfig.findMany();
  for (const config of configs) {
    const closeMinutes = timeStringToMinutes(config.closeTime);
    const before = config.reminderMinutesBeforeClose ?? DEFAULT_REMINDER_MINUTES_BEFORE_CLOSE;
    const after = config.reminderMinutesAfterClose ?? DEFAULT_REMINDER_MINUTES_AFTER_CLOSE;
    const windowStart = closeMinutes - before;
    const windowEnd = closeMinutes + after;
    if (nowMinutes < windowStart || nowMinutes > windowEnd) continue;

    const pending = await prisma.teacherAttendance.findMany({
      where: { schoolId: config.schoolId, date: today, checkInAt: { not: null }, checkOutAt: null },
      select: { userId: true },
    });

    for (const { userId } of pending) {
      const alreadyReminded = await prisma.teacherAttendanceActivityLog.findFirst({
        where: { userId, action: 'reminder_sent', createdAt: { gte: todayStart } },
        select: { id: true },
      });
      if (alreadyReminded) continue;

      try {
        await createNotification(
          {
            recipientId: userId,
            type: 'reminder',
            title: "Don't forget to check out",
            message: 'School is closing soon — remember to check out before you leave.',
            link: '/attendance?tab=check-in',
          },
          socketServer
        );
      } catch (err) {
        console.error('[teacher-attendance] checkout reminder notification failed', { userId, message: err.message });
      }

      await logTeacherAttendanceActivity({
        schoolId: config.schoolId,
        userId,
        action: 'reminder_sent',
        result: `sent near closing time on ${today}`,
      });
    }
  }
}

module.exports = { runCheckoutReminderSweep, SWEEP_INTERVAL_MS };
