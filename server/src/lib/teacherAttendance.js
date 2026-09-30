// Teacher (self) attendance: the arrival, departure and working-time rules. One implementation, so the number
// can't drift between the check-in response, the history view and reports (same idea as classroomAttendance.js).
// Every function is pure (no Prisma, Date.now() or I/O) so the tables can be pinned by exact tests; anything
// needing the database belongs in the route layer.
// Timezone: the app serves Indian schools only and school timings are plain "HH:MM" local values, so
// IST_OFFSET_MINUTES converts a UTC timestamp to IST minutes-of-day without a timezone library. It's the one
// place that assumption lives.

const IST_OFFSET_MINUTES = 5 * 60 + 30; // UTC+5:30, fixed
const MINUTES_PER_DAY = 24 * 60;

/**
 * "HH:MM" -> minutes since midnight, for school-timing config values.
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
 * A stored UTC Date -> minutes since midnight IST, for comparison with a school's "HH:MM" timings.
 * @param {Date} date
 * @returns {number}
 */
function utcDateToIstMinutesOfDay(date) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

/**
 * A school day's required working time in minutes (closing minus opening).
 * @param {{openTime: string, closeTime: string}} config
 * @returns {number}
 */
function computeRequiredMinutes(config) {
  return timeStringToMinutes(config.closeTime) - timeStringToMinutes(config.openTime);
}

/**
 * Classify a check-in against the school's opening time and check-in window.
 * `lateMinutes` is the raw minutes past opening (0 if on time), even when grace makes the classification
 * "on_time", so the figure stays available for audit. Only the window's close blocks a check-in;
 * arriving early never does.
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

// Only decides whether a checkout is labelled "left early" in Reports/History; checkout has no time-of-day
// gate (only location can block it). Distinct from fullDayGraceMinutes, which decides Present vs Half day.
const EARLY_DEPARTURE_LABEL_GRACE_MINUTES = 15;

/**
 * How early a check-out was relative to closing time. Informational only: no route branches on `isEarly`.
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
 * Total time at school in minutes: raw elapsed time, no break deduction.
 * @param {Date} checkInAt
 * @param {Date} checkOutAt
 * @returns {number}
 */
function computeWorkingMinutes(checkInAt, checkOutAt) {
  return Math.max(0, Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
}

// A fixed sanity floor, not a school setting. A school's half-day percentage could otherwise let a
// check-in followed by an immediate check-out pass as an ordinary half day; below this it's not really a
// day and is always worth a Principal's attention.
const MINIMUM_PLAUSIBLE_WORKING_MINUTES = 30;

/**
 * Is a check-in-to-check-out gap too short to be a real day, as opposed to a short or half day?
 * @param {number} workingMinutes
 * @returns {boolean}
 */
function isImplausiblyShortDay(workingMinutes) {
  return workingMinutes < MINIMUM_PLAUSIBLE_WORKING_MINUTES;
}

/**
 * Full day, present-with-shortfall or half day. `requiredMinutes` is passed in so callers comparing
 * several teachers against one school config don't recompute it.
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
 * Great-circle distance between two coordinates in metres (haversine). Routes use it to recompute
 * distance from the school's geofence centre and never trust a client-reported "inside: true".
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
 * A UTC Date -> its IST calendar date as "YYYY-MM-DD", the format TeacherAttendance.date is stored in.
 * @param {Date} date
 * @returns {string}
 */
function istDateString(date) {
  // The IST day can differ from the UTC day near midnight. Shifting by the IST offset before reading getUTC*()
  // gives the IST date without a timezone library.
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The status a record should be read as, which can differ from its stored `status`: a past day with a
 * check-in but no check-out needs regularizing by the next day. Computed at read time, so no day-end job is
 * needed; every route returning a TeacherAttendance row uses this rather than `status`.
 * `wasReviewed` stops the override re-applying to a day a Principal already resolved, which never sets checkOutAt.
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
 * A UTC Date -> its IST day of week (0=Sunday..6), using the same IST shift as istDateString.
 * @param {Date} date
 * @returns {number}
 */
function istDayOfWeek(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  return shifted.getUTCDay();
}

/**
 * Is this date one of the school's weekly off days? `weeklyOffDays` is a comma-separated string ("0" or "0,6"),
 * parsed here so only one place knows the format.
 * @param {Date} date
 * @param {{weeklyOffDays: string}} config
 * @returns {boolean}
 */
function isWeeklyOff(date, config) {
  const offDays = String(config.weeklyOffDays ?? '')
    .split(',')
    .map((d) => d.trim())
    // Drop empty entries first: Number('') is 0, so an empty string or trailing comma would parse as Sunday.
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
 * The later of the school's config creation date and a person's account creation date, as "YYYY-MM-DD":
 * the earliest date a month summary covers, so nobody is counted Absent for time before tracking or their
 * account existed. Mirrors sinceDateFor() in client/src/lib/teacherAttendanceCalendar.ts; keep them in step by hand.
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
 * Every "YYYY-MM-DD" date in `month` ("YYYY-MM") from the 1st to the month end or `throughDate`, whichever is
 * earlier, floored at `sinceDate`. Mirrors buildMonthDates() in client/src/lib/teacherAttendanceCalendar.ts.
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
 * Counts how many days in one teacher's month fall into each outcome, for the Excel export. The
 * client computes the same thing for the on-screen table (buildRows/summarizeRows in
 * client/src/lib/teacherAttendanceCalendar.ts); keep them in step by hand.
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
