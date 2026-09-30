// Request-body validation for Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md).
// checkInSchema/checkOutSchema carry only raw evidence (lat, lon, accuracy, device id) and no verdict field: the
// phone proposes and the server decides, always recomputing distance and status via lib/teacherAttendance.js.
// There's no client-clock field either: the server's receipt time is authoritative. Add one, with storage and a
// route that persists it, only when the offline queue needs it to detect an implausible sync gap.
// Selfie capture isn't a field here; image bytes get their own upload path, like ProfilePicture.
const { z } = require('zod');

const { timeStringToMinutes } = require('./teacherAttendance');

const latSchema = z.number().min(-90).max(90);
const lonSchema = z.number().min(-180).max(180);

const locationEvidenceSchema = {
  lat: latSchema,
  lon: lonSchema,
  accuracyMeters: z.number().nonnegative(),
  deviceId: z.string().trim().min(1).max(200).optional(),
};

const checkInSchema = z.object(locationEvidenceSchema).strict();
const checkOutSchema = z.object(locationEvidenceSchema).strict();

// One mandatory reason for every action (approvals, corrections, leave/duty marks): a review can't be a blank click.
const REVIEW_ACTIONS = ['approve', 'correct_checkin', 'correct_checkout', 'mark_on_leave', 'mark_on_duty', 'reject'];

const reviewActionSchema = z
  .object({
    action: z.enum(REVIEW_ACTIONS),
    reason: z.string().trim().min(1, 'A reason is required for every attendance review action.').max(1000),
    correctedCheckInAt: z.string().datetime().optional(),
    correctedCheckOutAt: z.string().datetime().optional(),
    // Free text, not an enum: the official leave/duty category list is still pending from the department, so changing it needs no migration.
    leaveOrDutyCategory: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.action === 'correct_checkin' && !data.correctedCheckInAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctedCheckInAt'],
        message: 'correctedCheckInAt is required when action is "correct_checkin".',
      });
    }
    if (data.action === 'correct_checkout' && !data.correctedCheckOutAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctedCheckOutAt'],
        message: 'correctedCheckOutAt is required when action is "correct_checkout".',
      });
    }
    if ((data.action === 'mark_on_leave' || data.action === 'mark_on_duty') && !data.leaveOrDutyCategory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leaveOrDutyCategory'],
        message: 'leaveOrDutyCategory is required when marking a day as leave or on-duty.',
      });
    }
  });

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected "HH:MM" 24-hour time.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected "YYYY-MM-DD".');
// Comma-separated day-of-week numbers (0=Sunday..6), e.g. "0" or "0,6", parsed by isWeeklyOff() in lib/teacherAttendance.js.
// An empty string is valid: no weekly off day.
const weeklyOffDaysSchema = z
  .string()
  .regex(/^$|^[0-6](,[0-6])*$/, 'Expected comma-separated day numbers 0-6 (0=Sunday), e.g. "0" or "0,6".');

// A school_admin's own school config: geofence, timings and thresholds. Numeric fields are optional on write (PUT is a
// partial update) but all are needed to enable check-ins; the route enforces that, since "does a config exist" is a database question.
const schoolAttendanceConfigSchema = z
  .object({
    openTime: timeOfDaySchema,
    closeTime: timeOfDaySchema,
    checkinWindowStart: timeOfDaySchema,
    checkinWindowEnd: timeOfDaySchema,
    weeklyOffDays: weeklyOffDaysSchema.optional(),
    lateGraceMinutes: z.number().int().min(0).max(120).optional(),
    halfDayThresholdPercent: z.number().int().min(1).max(100).optional(),
    fullDayGraceMinutes: z.number().int().min(0).max(120).optional(),
    // earlyDepartureGraceMinutes is gone: it only labels a checkout "left early" and never affects Present/Half-day, so it's a
    // constant now (EARLY_DEPARTURE_LABEL_GRACE_MINUTES in lib/teacherAttendance.js).
    geofenceLat: z.number().min(-90).max(90),
    geofenceLon: z.number().min(-180).max(180),
    geofenceRadiusMeters: z.number().int().min(20).max(5000).optional(),
    repeatPatternThreshold: z.number().int().min(1).max(100).optional(),
    repeatPatternWindowDays: z.number().int().min(1).max(365).optional(),
    reminderMinutesBeforeClose: z.number().int().min(0).max(120).optional(),
    reminderMinutesAfterClose: z.number().int().min(0).max(120).optional(),
  })
  .strict()
  // Catches a typo'd config early: a closeTime before openTime would make computeRequiredMinutes negative and every
  // day-status calculation wrong.
  .superRefine((data, ctx) => {
    // timeStringToMinutes throws on a malformed string. A field that already failed timeOfDaySchema's regex has its own
    // issue, so skip it here rather than turning the throw into a 500.
    try {
      if (timeStringToMinutes(data.closeTime) <= timeStringToMinutes(data.openTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['closeTime'],
          message: 'Closing time must be after opening time.',
        });
      }
      if (timeStringToMinutes(data.checkinWindowEnd) <= timeStringToMinutes(data.checkinWindowStart)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['checkinWindowEnd'],
          message: 'Check-in window end must be after check-in window start.',
        });
      }
    } catch {
      /* a malformed time string already produced its own issue above */
    }
  });

const createHolidaySchema = z
  .object({
    date: dateStringSchema,
    reason: z.string().trim().min(1).max(300),
    // "principal_emergency" is the only value a school_admin's request can set; "department" is reserved for a future
    // bulk-import path.
    source: z.literal('principal_emergency').default('principal_emergency'),
  })
  .strict();

module.exports = {
  REVIEW_ACTIONS,
  checkInSchema,
  checkOutSchema,
  reviewActionSchema,
  schoolAttendanceConfigSchema,
  createHolidaySchema,
};
