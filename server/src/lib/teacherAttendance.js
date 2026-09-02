// Teacher (self) attendance — the arrival/departure/working-time math, per
// docs/attendance-plan-review.md and docs/feature-teacher-attendance-implementation-plan.md.
//
// ONE implementation of every rule here — every route that reads or writes a
// TeacherAttendance row calls these functions, never reimplements the
// comparison inline — mirrors classroomAttendance.js's own reasoning: the
// number must never drift between the check-in response, the review queue,
// and the teacher's own history view.
//
// Every function here is PURE (no Prisma, no Date.now(), no I/O) so the
// arrival/status tables from the review doc can be pinned down as exact,
// deterministic tests. Anything that needs the database (looking up a
// teacher's day, counting a repeated-exception pattern across many days)
// belongs in the route layer, not here — same separation
// classroomAttendance.js draws between its pure helpers and its
// prisma-calling functions.
//
// Timezone: this app serves Indian schools only, and school timings
// (openTime/closeTime/etc.) are always plain "HH:MM" local wall-clock
// values. Rather than pull in a timezone library for a single, fixed
// offset, IST_OFFSET_MINUTES below converts a stored UTC timestamp to an
// IST minutes-of-day figure directly. If this app ever serves schools
// outside IST, this constant is the one place that assumption lives.

const IST_OFFSET_MINUTES = 5 * 60 + 30; // UTC+5:30, fixed
const MINUTES_PER_DAY = 24 * 60;

/**
 * "HH:MM" -> minutes since midnight. Used for every school-timing config
 * value (openTime, closeTime, checkinWindowStart/End).
 * @param {string} timeStr e.g. "09:00"
 * @returns {number}
 */
function timeStringToMinutes(timeStr) {
  const [hoursRaw, minutesRaw] = String(timeStr).split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`teacherAttendance: invalid time string "${timeStr}", expected "HH:MM"`);
  }
  return hours * 60 + minutes;
}

/**
 * A stored UTC Date -> minutes since midnight IST. This is how a raw
 * check-in/check-out timestamp gets compared against a school's "HH:MM"
 * timing config.
 * @param {Date} date
 * @returns {number}
 */
function utcDateToIstMinutesOfDay(date) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

/**
 * A school day's required working time, in minutes — closing minus opening.
 * @param {{openTime: string, closeTime: string}} config
 * @returns {number}
 */
function computeRequiredMinutes(config) {
  return timeStringToMinutes(config.closeTime) - timeStringToMinutes(config.openTime);
}

/**
 * Classify a check-in against the school's opening time and check-in
 * window (docs/attendance-plan-review.md §4's three-tier table).
 *
 * `lateMinutes` is always the RAW minutes past opening time (0 if the
 * teacher arrived at or before opening), even when the classification is
 * "on_time" because it fell inside the grace period — the raw figure stays
 * available for audit/transparency, it just isn't what decides the
 * classification once it's within grace.
 *
 * Only the window's CLOSE matters for blocking — check-in has no earliest
 * time at all, only a latest one: allowed any time up through
 * `checkinWindowEnd`, at the school's location, full stop. (An earlier
 * version of this function also rejected arriving before
 * `checkinWindowStart` — reverted: the decided rule is that arriving early
 * is never a problem worth blocking, only arriving too late is.)
 *
 * @param {Date} checkInAt
 * @param {{openTime: string, checkinWindowEnd: string, lateGraceMinutes: number}} config
 * @returns {{classification: 'on_time'|'late'|'outside_window', lateMinutes: number}}
 */
function classifyArrival(checkInAt, config) {
  const arrivalMinutes = utcDateToIstMinutesOfDay(checkInAt);
  const openMinutes = timeStringToMinutes(config.openTime);
  const windowEndMinutes = timeStringToMinutes(config.checkinWindowEnd);
  const graceMinutes = config.lateGraceMinutes ?? 0;

  const lateMinutes = Math.max(0, arrivalMinutes - openMinutes);

  if (arrivalMinutes > windowEndMinutes) {
    return { classification: 'outside_window', lateMinutes };
  }
  if (lateMinutes > graceMinutes) {
    return { classification: 'late', lateMinutes };
  }
  return { classification: 'on_time', lateMinutes };
}

// Purely a label threshold now, not a school policy — checkout has no
// time-of-day gate at all (a teacher physically at school can check out
// whenever they leave; only location can block it), so this no longer
// needs to be something a Principal tunes per school. Used only to decide
// whether a checkout gets labeled "left early" in Reports/History; distinct
// from fullDayGraceMinutes, which is what actually decides Present vs Half
// day based on total hours worked. Was a per-school SchoolAttendanceConfig
// field (earlyDepartureGraceMinutes); fixed here once the field's only
// remaining job was this label, to stop it being confused with the grace
// setting that actually matters (fullDayGraceMinutes).
const EARLY_DEPARTURE_LABEL_GRACE_MINUTES = 15;

/**
 * How early a check-out was, relative to closing time. Independent of
 * deriveDayStatus's shortfall figure — this is specifically "did they leave
 * before closing," shown to the teacher/Principal as its own fact even
 * though both numbers come from the same underlying gap (review doc §4).
 *
 * Purely informational — checkout has no time-of-day gate at all (decided
 * rule: a teacher physically at school can check out whenever they leave;
 * only location can block it). `isEarly` is kept for callers that want a
 * simple boolean, but nothing in the checkout route branches on it anymore.
 *
 * @param {Date} checkOutAt
 * @param {{closeTime: string}} config
 * @returns {{isEarly: boolean, earlyMinutes: number}}
 */
function computeEarlyDeparture(checkOutAt, config) {
  const departureMinutes = utcDateToIstMinutesOfDay(checkOutAt);
  const closeMinutes = timeStringToMinutes(config.closeTime);

  const earlyMinutes = Math.max(0, closeMinutes - departureMinutes);
  return { isEarly: earlyMinutes > EARLY_DEPARTURE_LABEL_GRACE_MINUTES, earlyMinutes };
}

/**
 * Total time at school, in minutes. Raw elapsed time — no break deduction,
 * per the review doc's base model.
 * @param {Date} checkInAt
 * @param {Date} checkOutAt
 * @returns {number}
 */
function computeWorkingMinutes(checkInAt, checkOutAt) {
  return Math.max(0, Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
}

// Not school-configurable, unlike halfDayThresholdPercent — this is a fixed
// sanity floor, not a policy setting. A school's own half-day percentage
// could theoretically let an arbitrarily short "day" (check in, immediately
// check out) through as an ordinary half day, unflagged, indistinguishable
// from a teacher who legitimately left early for a real reason. Below this
// floor isn't "a short day," it's "not really a day" — always worth a
// Principal's attention regardless of how the school's other thresholds are set.
const MINIMUM_PLAUSIBLE_WORKING_MINUTES = 30;

/**
 * Is a check-in-to-check-out gap too short to be a real day at all, as
 * opposed to an ordinary short/half day?
 * @param {number} workingMinutes
 * @returns {boolean}
 */
function isImplausiblyShortDay(workingMinutes) {
  return workingMinutes < MINIMUM_PLAUSIBLE_WORKING_MINUTES;
}

/**
 * Full day / present-with-shortfall / half day, per the review doc's §4
 * table. `requiredMinutes` is expected to be computeRequiredMinutes(config)
 * — passed in rather than recomputed here so a caller that already has it
 * (e.g. computing several teachers against the same school config) doesn't
 * redo the work.
 *
 * @param {number} workingMinutes
 * @param {number} requiredMinutes
 * @param {{halfDayThresholdPercent: number, fullDayGraceMinutes: number}} config
 * @returns {{dayStatus: 'full_day'|'present_shortfall'|'half_day', shortfallMinutes: number}}
 */
function deriveDayStatus(workingMinutes, requiredMinutes, config) {
  const fullDayThreshold = requiredMinutes - (config.fullDayGraceMinutes ?? 0);
  const halfDayThreshold = requiredMinutes * ((config.halfDayThresholdPercent ?? 50) / 100);

  if (workingMinutes >= fullDayThreshold) {
    return { dayStatus: 'full_day', shortfallMinutes: 0 };
  }
  const shortfallMinutes = Math.max(0, requiredMinutes - workingMinutes);
  if (workingMinutes >= halfDayThreshold) {
    return { dayStatus: 'present_shortfall', shortfallMinutes };
  }
  return { dayStatus: 'half_day', shortfallMinutes };
}

/**
 * Great-circle distance between two coordinates, in metres (haversine).
 * This is what a check-in/check-out route uses to independently recompute
 * distance from the school's stored geofence centre — never trusting a
 * client-reported "inside: true" flag (attendance-system-design.html §6).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_METERS = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * A UTC Date -> its IST calendar date, as "YYYY-MM-DD". This is the format
 * TeacherAttendance.date is stored in (a plain string, not a DateTime — the
 * "one row per teacher per day" uniqueness only needs a calendar date, never
 * a time component or timezone-aware comparison).
 * @param {Date} date
 * @returns {string}
 */
function istDateString(date) {
  // The IST calendar day can differ from the UTC one near midnight IST (e.g.
  // 12:15 AM IST on the 2nd is 6:45 PM UTC on the 1st — a day earlier in
  // UTC). Shifting the instant itself by the IST offset before reading
  // getUTC*() lands on the correct IST calendar date without needing a
  // timezone library.
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The status a record should be READ as, which can differ from its stored
 * `status` column without anyone having written to it: a record from a past
 * day with a check-in but no check-out was never explicitly flagged, but by
 * the next day it clearly needs regularizing (attendance-plan-review.md §4
 * example 7 / §8 "missing checkout"). Computed at read time rather than by
 * a scheduled job, so there is no day-end sweep to keep running — every
 * route that returns a TeacherAttendance row calls this instead of reading
 * `status` directly.
 *
 * `wasReviewed` stops this override from re-applying to a record a
 * Principal has already resolved — approving/correcting/marking a day
 * leave/on-duty never sets checkOutAt, so without this flag an already
 * -resolved record would keep reading (and keep re-queueing, see
 * routes/teacherAttendance.js's review-queue filter) as "still pending"
 * forever, undoing the review that just happened.
 * @param {{status: string, checkOutAt: Date|null, date: string, wasReviewed?: boolean}} record
 * @param {string} todayDateString "YYYY-MM-DD", from istDateString(new Date())
 * @returns {string}
 */
function deriveEffectiveStatus(record, todayDateString) {
  if (!record.checkOutAt && record.date < todayDateString && !record.wasReviewed) {
    return 'pending_regularization';
  }
  return record.status;
}

/**
 * A UTC Date -> its IST day of week, 0=Sunday..6=Saturday (JS Date.getDay()
 * convention) — same IST-shift technique as istDateString, so a check-in a
 * few minutes either side of midnight IST reads as the correct IST weekday,
 * not whatever UTC day the instant happens to fall on.
 * @param {Date} date
 * @returns {number}
 */
function istDayOfWeek(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  return shifted.getUTCDay();
}

/**
 * Is this date one of the school's weekly off days (e.g. every Sunday)?
 * `weeklyOffDays` is SchoolAttendanceConfig's own comma-separated string
 * ("0" or "0,6") — parsed here rather than at the call site so there is one
 * place that knows the format.
 * @param {Date} date
 * @param {{weeklyOffDays: string}} config
 * @returns {boolean}
 */
function isWeeklyOff(date, config) {
  const offDays = String(config.weeklyOffDays ?? '')
    .split(',')
    .map((d) => d.trim())
    // Empty entries first — Number('') is 0, not NaN, so an empty string
    // (or a stray trailing comma) would otherwise silently parse as
    // "Sunday" instead of "nothing configured."
    .filter((d) => d !== '')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return offDays.includes(istDayOfWeek(date));
}

/**
 * Is a computed distance inside the school's geofence radius?
 * @param {number} distanceInMeters
 * @param {{geofenceRadiusMeters: number}} config
 * @returns {boolean}
 */
function isWithinGeofence(distanceInMeters, config) {
  return distanceInMeters <= config.geofenceRadiusMeters;
}

/**
 * The later of the school's config creation date and a specific person's
 * own account creation date, as "YYYY-MM-DD" — the earliest date a month
 * summary should ever cover, so neither a school that just turned tracking
 * on, nor someone who joined after that, gets counted as Absent for time
 * before either existed. Mirrors client/src/lib/teacherAttendanceCalendar.ts's
 * sinceDateFor() — kept in step by hand, no shared package between server
 * and client in this repo.
 * @param {{createdAt: Date}|null} config
 * @param {Date|null|undefined} personCreatedAt
 * @returns {string|undefined}
 */
function sinceDateFor(config, personCreatedAt) {
  if (!config) return undefined;
  const candidates = [config.createdAt, personCreatedAt].filter(Boolean).map((d) => d.toISOString());
  return candidates.sort().pop().slice(0, 10);
}

/**
 * Every "YYYY-MM-DD" date in `month` ("YYYY-MM"), from the 1st through
 * either the end of the month or `throughDate` (today), whichever is
 * earlier, floored at `sinceDate` if given. Mirrors
 * client/src/lib/teacherAttendanceCalendar.ts's buildMonthDates() exactly.
 * @param {string} month
 * @param {string} throughDate
 * @param {string} [sinceDate]
 * @returns {string[]}
 */
function datesInMonth(month, throughDate, sinceDate) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = month === throughDate.slice(0, 7) ? Number(throughDate.slice(8, 10)) : daysInMonth;

  let firstDay = 1;
  if (sinceDate) {
    const sinceMonth = sinceDate.slice(0, 7);
    if (month < sinceMonth) return [];
    if (month === sinceMonth) firstDay = Number(sinceDate.slice(8, 10));
  }

  const dates = [];
  for (let day = firstDay; day <= lastDay; day++) {
    dates.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

/**
 * Counts, for one teacher's month, how many days fall into each outcome —
 * the server-side twin of client/src/lib/teacherAttendanceCalendar.ts's
 * buildRows()+summarizeRows(), needed here for the Excel export (the
 * on-screen Reports table computes the same thing client-side from the
 * same raw records — the two are kept in step by hand).
 * @param {string[]} dates
 * @param {Array<{date: string, status: string, lateMinutes: number|null}>} records already status-effective (attendanceToDto output)
 * @param {{weeklyOffDays: string}} config
 * @param {Set<string>} holidayDates
 * @returns {{present: number, absent: number, late: number, half_day: number, on_leave: number, on_duty: number, flagged_review: number, pending_regularization: number}}
 */
function summarizeTeacherMonth(dates, records, config, holidayDates) {
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const summary = {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    on_leave: 0,
    on_duty: 0,
    flagged_review: 0,
    pending_regularization: 0,
  };
  for (const date of dates) {
    const record = recordByDate.get(date);
    if (record) {
      summary[record.status] = (summary[record.status] ?? 0) + 1;
      if (record.lateMinutes) summary.late += 1;
      continue;
    }
    if (holidayDates.has(date)) continue;
    if (isWeeklyOff(new Date(`${date}T12:00:00Z`), config)) continue;
    summary.absent += 1;
  }
  return summary;
}

module.exports = {
  IST_OFFSET_MINUTES,
  timeStringToMinutes,
  utcDateToIstMinutesOfDay,
  computeRequiredMinutes,
  classifyArrival,
  computeEarlyDeparture,
  computeWorkingMinutes,
  deriveDayStatus,
  distanceMeters,
  isWithinGeofence,
  istDateString,
  istDayOfWeek,
  isWeeklyOff,
  deriveEffectiveStatus,
  sinceDateFor,
  datesInMonth,
  summarizeTeacherMonth,
  MINIMUM_PLAUSIBLE_WORKING_MINUTES,
  isImplausiblyShortDay,
};
