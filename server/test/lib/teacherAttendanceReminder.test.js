// runCheckoutReminderSweep — docs/feature-teacher-attendance-implementation-plan.md
// §1.4/§5. Exercises the sweep directly against Prisma (not through HTTP —
// there's no route for this, it's a background job) with schoolAttendanceConfig
// and teacherAttendance rows set up by hand.
const { prisma } = require('../helpers/testApp');
const { createFixtures } = require('../helpers/fixtures');
const { runCheckoutReminderSweep } = require('../../src/lib/teacherAttendanceReminder');

const ENV_KEYS = ['TEACHER_ATTENDANCE_ENABLED', 'NOTIFICATIONS_ENABLED'];

// closeTime 16:00 -> reminder window is 15:45..16:30 IST.
const CONFIG = {
  openTime: '09:00',
  closeTime: '16:00',
  checkinWindowStart: '08:30',
  checkinWindowEnd: '10:00',
  geofenceLat: 12.9716,
  geofenceLon: 77.5946,
};

function istDateTime(dateStr, hours, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const istMinutesOfDay = hours * 60 + minutes;
  const utcMinutesOfDay = (istMinutesOfDay - (5 * 60 + 30) + 1440) % 1440;
  const dayRollback = istMinutesOfDay - (5 * 60 + 30) < 0 ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d - dayRollback, Math.floor(utcMinutesOfDay / 60), utcMinutesOfDay % 60));
}

describe('runCheckoutReminderSweep', () => {
  let fx;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'remind');
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.TEACHER_ATTENDANCE_ENABLED = 'true';
    process.env.NOTIFICATIONS_ENABLED = 'true';
    await prisma.schoolAttendanceConfig.create({ data: { schoolId: fx.schoolA.id, ...CONFIG } });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function checkedInNotOut(date) {
    return prisma.teacherAttendance.create({
      data: {
        userId: fx.teacherA.id,
        schoolId: fx.schoolA.id,
        date,
        checkInAt: istDateTime(date, 9, 0),
        status: 'present',
        lateMinutes: 0,
      },
    });
  }

  test('does nothing when the feature flag is off', async () => {
    const record = await checkedInNotOut('2026-04-01');
    delete process.env.TEACHER_ATTENDANCE_ENABLED;
    await runCheckoutReminderSweep(istDateTime('2026-04-01', 15, 50));
    process.env.TEACHER_ATTENDANCE_ENABLED = 'true';

    const logs = await prisma.teacherAttendanceActivityLog.count({ where: { userId: fx.teacherA.id, action: 'reminder_sent' } });
    expect(logs).toBe(0);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('does nothing outside the reminder window (too early)', async () => {
    const record = await checkedInNotOut('2026-04-02');
    await runCheckoutReminderSweep(istDateTime('2026-04-02', 13, 0)); // well before 15:45
    const logs = await prisma.teacherAttendanceActivityLog.count({ where: { userId: fx.teacherA.id, action: 'reminder_sent' } });
    expect(logs).toBe(0);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('does nothing outside the reminder window (too late)', async () => {
    const record = await checkedInNotOut('2026-04-03');
    await runCheckoutReminderSweep(istDateTime('2026-04-03', 18, 0)); // well after 16:30
    const logs = await prisma.teacherAttendanceActivityLog.count({ where: { userId: fx.teacherA.id, action: 'reminder_sent' } });
    expect(logs).toBe(0);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('reminds a teacher who checked in but has not checked out, inside the window', async () => {
    const record = await checkedInNotOut('2026-04-04');
    await runCheckoutReminderSweep(istDateTime('2026-04-04', 15, 50));

    const logs = await prisma.teacherAttendanceActivityLog.findMany({
      where: { userId: fx.teacherA.id, action: 'reminder_sent' },
    });
    expect(logs).toHaveLength(1);

    const notifications = await prisma.notification.findMany({ where: { recipientId: fx.teacherA.id } });
    expect(notifications.some((n) => n.title === "Don't forget to check out")).toBe(true);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('a second sweep the same day does not remind twice', async () => {
    const record = await checkedInNotOut('2026-04-05');
    await runCheckoutReminderSweep(istDateTime('2026-04-05', 15, 46));
    await runCheckoutReminderSweep(istDateTime('2026-04-05', 15, 55));

    const logs = await prisma.teacherAttendanceActivityLog.count({
      where: { userId: fx.teacherA.id, action: 'reminder_sent' },
    });
    expect(logs).toBe(1);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('a teacher who already checked out is never reminded', async () => {
    const record = await prisma.teacherAttendance.create({
      data: {
        userId: fx.teacherA.id,
        schoolId: fx.schoolA.id,
        date: '2026-04-06',
        checkInAt: istDateTime('2026-04-06', 9, 0),
        checkOutAt: istDateTime('2026-04-06', 16, 0),
        status: 'present',
        lateMinutes: 0,
        workingMinutes: 420,
      },
    });
    await runCheckoutReminderSweep(istDateTime('2026-04-06', 15, 50));
    const logs = await prisma.teacherAttendanceActivityLog.count({
      where: { userId: fx.teacherA.id, action: 'reminder_sent', result: { contains: '2026-04-06' } },
    });
    expect(logs).toBe(0);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });

  test('a school with a custom reminder window uses its own setting, not the schema default', async () => {
    // A second school, configured to start reminding a full hour before
    // closing instead of the default 15 minutes — 16:00 - 60min = 15:00.
    const fx2 = await createFixtures(prisma, 'remind2');
    await prisma.schoolAttendanceConfig.create({
      data: { schoolId: fx2.schoolA.id, ...CONFIG, reminderMinutesBeforeClose: 60, reminderMinutesAfterClose: 5 },
    });
    const record = await prisma.teacherAttendance.create({
      data: {
        userId: fx2.teacherA.id,
        schoolId: fx2.schoolA.id,
        date: '2026-04-07',
        checkInAt: istDateTime('2026-04-07', 9, 0),
        status: 'present',
        lateMinutes: 0,
      },
    });

    // 15:10 is inside the CUSTOM window (15:00-16:05) but would be outside
    // the default 15/30 window (15:45-16:30) — proves the per-school
    // setting is actually what's being read, not the hardcoded default.
    await runCheckoutReminderSweep(istDateTime('2026-04-07', 15, 10));

    const logs = await prisma.teacherAttendanceActivityLog.count({
      where: { userId: fx2.teacherA.id, action: 'reminder_sent' },
    });
    expect(logs).toBe(1);
    await prisma.teacherAttendance.delete({ where: { id: record.id } });
  });
});
