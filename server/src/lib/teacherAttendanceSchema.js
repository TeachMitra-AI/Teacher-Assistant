// Request-body validation for Teacher Attendance
// (docs/feature-teacher-attendance-implementation-plan.md §3).
//
// checkInSchema/checkOutSchema deliberately carry ONLY raw evidence — lat,
// lon, accuracy, and device id. There is no "insideGeofence" or "status"
// field here: the whole point of the server-side design
// (attendance-system-design.html §6, "the phone proposes, the server
// decides") is that a verdict computed on the phone is never trusted — the
// server always recomputes distance/status itself from these raw numbers
// via lib/teacherAttendance.js. Adding a client-supplied verdict field here
// would be exactly the mistake that design exists to prevent.
//
// No client-clock field either (deliberately removed, not just never
// added): the server's own receipt time is authoritative for every rule
// calculation, a phone's clock can't be trusted for anything security
// -relevant, and there was no consumer yet actually reading a client-sent
// timestamp — carrying it around unused was exactly the kind of
// speculative field this project avoids. Add it back, WITH real storage on
// TeacherAttendance and a route that actually persists it, the day the
// offline-queue feature needs it for detecting an implausible sync gap —
// not before.
//
// Selfie capture is intentionally NOT a field on these schemas. Like
// ProfilePicture, image bytes get their own upload path rather than living
// in a JSON body next to small scalar fields — that's a separate piece of
// work, not designed here.
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

// One reason field for every action — approvals, corrections, and
// leave/duty marks all go through the same mandatory-reason discipline
// (attendance-plan-review.md §11: "every approval or correction must
// include a written reason — it can't be a blank 'approve' click").
const REVIEW_ACTIONS = ['approve', 'correct_checkin', 'correct_checkout', 'mark_on_leave', 'mark_on_duty', 'reject'];

const reviewActionSchema = z
  .object({
    action: z.enum(REVIEW_ACTIONS),
    reason: z.string().trim().min(1, 'A reason is required for every attendance review action.').max(1000),
    correctedCheckInAt: z.string().datetime().optional(),
    correctedCheckOutAt: z.string().datetime().optional(),
    // Free text on purpose, not a fixed enum — the official leave/duty
    // category list is still pending from the department (review doc §1/§9).
    // Changing the allowed values later needs no schema or migration change.
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
// Comma-separated day-of-week numbers (0=Sunday..6=Saturday), e.g. "0" or
// "0,6" — matches lib/teacherAttendance.js's isWeeklyOff() parsing exactly.
// Empty string is valid too — "no weekly off day configured."
const weeklyOffDaysSchema = z
  .string()
  .regex(/^$|^[0-6](,[0-6])*$/, 'Expected comma-separated day numbers 0-6 (0=Sunday), e.g. "0" or "0,6".');

// A school_admin's own school config — geofence, timings, and every
// threshold from attendance-plan-review.md §8's settings table. All numeric
// fields are optional on write (PUT does a partial update, same shape as
// classroom.js's updateClassSchema) but required together to actually
// enable check-ins for a school — the route layer enforces that, not this
// schema, since "does a config exist yet" is a database question.
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
    // earlyDepartureGraceMinutes deliberately removed — it never affects
    // Present/Half-day status (fullDayGraceMinutes above does that), it
    // only labels a checkout "left early" in Reports/History, so it's a
    // fixed constant now (EARLY_DEPARTURE_LABEL_GRACE_MINUTES in
    // lib/teacherAttendance.js), not a per-school setting a Principal needs
    // to think about alongside the grace that actually matters.
    geofenceLat: z.number().min(-90).max(90),
    geofenceLon: z.number().min(-180).max(180),
    geofenceRadiusMeters: z.number().int().min(20).max(5000).optional(),
    repeatPatternThreshold: z.number().int().min(1).max(100).optional(),
    repeatPatternWindowDays: z.number().int().min(1).max(365).optional(),
    reminderMinutesBeforeClose: z.number().int().min(0).max(120).optional(),
    reminderMinutesAfterClose: z.number().int().min(0).max(120).optional(),
  })
  .strict()
  // Catches a typo'd config before it ever reaches the database — without
  // this, a closeTime before openTime silently makes computeRequiredMinutes
  // (lib/teacherAttendance.js) negative, and every Full day/Half day/
  // shortfall calculation downstream comes out wrong instead of being
  // rejected up front.
  .superRefine((data, ctx) => {
    // timeStringToMinutes THROWS on a malformed string (by design — see its
    // own doc comment) rather than returning something wrong. A field that
    // already failed timeOfDaySchema's regex gets its own issue from that
    // check; this cross-field check has nothing useful to add for it, so it
    // skips silently instead of letting that throw become an unhandled 500.
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
    // "principal_emergency" is the only value a school_admin's own request
    // can set — "department" reserved for a future bulk-import path, per
    // attendance-plan-review.md §8/§9 ("department sets the yearly list,
    // Principal can add an emergency one-off closure").
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
