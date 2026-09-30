// Availability rule for Schedule a Call: a fixed rule, not a real calendar, with one operating timezone
// (DEMO_BOOKING_TIMEZONE) that isn't converted per visitor (see routes/scheduleDemo.js).
// Pure functions that take env as an argument (like lib/flags.js), so /config, /slots and tests share one rule.

const { parseIntEnv } = require('./config');

const DEMO_BOOKING_CONFIG_DEFAULTS = Object.freeze({
  timezone: 'Asia/Kolkata',
  workDays: Object.freeze([1, 2, 3, 4, 5]), // Mon-Fri, ISO weekday numbers (1=Mon..7=Sun)
  startTime: '10:00',
  endTime: '17:00',
  slotMinutes: 30,
  lookaheadDays: 21,
  minNoticeHours: 12,
});

const SLOT_MINUTES_BOUNDS = Object.freeze({ min: 5, max: 240 });
const LOOKAHEAD_DAYS_BOUNDS = Object.freeze({ min: 1, max: 90 });
const MIN_NOTICE_HOURS_BOUNDS = Object.freeze({ min: 0, max: 240 });

function parseWorkDays(rawValue, warn) {
  if (rawValue == null || String(rawValue).trim() === '') return [...DEMO_BOOKING_CONFIG_DEFAULTS.workDays];
  const days = String(rawValue)
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  if (days.length === 0) {
    warn(`[demoBookingConfig] DEMO_BOOKING_WORK_DAYS="${rawValue}" has no valid weekday numbers; using default.`);
    return [...DEMO_BOOKING_CONFIG_DEFAULTS.workDays];
  }
  return days;
}

function parseClockTime(rawValue, name, fallback, warn) {
  const value = rawValue == null || String(rawValue).trim() === '' ? fallback : String(rawValue).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    warn(`[demoBookingConfig] ${name}="${rawValue}" is not a valid HH:MM time; using default ${fallback}.`);
    return fallback;
  }
  return value;
}

/**
 * Read the Schedule a Call availability rule from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 */
function getDemoBookingConfig(env = process.env, { warn = console.warn } = {}) {
  return {
    timezone: env.DEMO_BOOKING_TIMEZONE || DEMO_BOOKING_CONFIG_DEFAULTS.timezone,
    workDays: parseWorkDays(env.DEMO_BOOKING_WORK_DAYS, warn),
    startTime: parseClockTime(env.DEMO_BOOKING_START_TIME, 'DEMO_BOOKING_START_TIME', DEMO_BOOKING_CONFIG_DEFAULTS.startTime, warn),
    endTime: parseClockTime(env.DEMO_BOOKING_END_TIME, 'DEMO_BOOKING_END_TIME', DEMO_BOOKING_CONFIG_DEFAULTS.endTime, warn),
    slotMinutes: parseIntEnv(env.DEMO_BOOKING_SLOT_MINUTES, {
      name: 'DEMO_BOOKING_SLOT_MINUTES',
      defaultValue: DEMO_BOOKING_CONFIG_DEFAULTS.slotMinutes,
      min: SLOT_MINUTES_BOUNDS.min,
      max: SLOT_MINUTES_BOUNDS.max,
      warn,
    }),
    lookaheadDays: parseIntEnv(env.DEMO_BOOKING_LOOKAHEAD_DAYS, {
      name: 'DEMO_BOOKING_LOOKAHEAD_DAYS',
      defaultValue: DEMO_BOOKING_CONFIG_DEFAULTS.lookaheadDays,
      min: LOOKAHEAD_DAYS_BOUNDS.min,
      max: LOOKAHEAD_DAYS_BOUNDS.max,
      warn,
    }),
    minNoticeHours: parseIntEnv(env.DEMO_BOOKING_MIN_NOTICE_HOURS, {
      name: 'DEMO_BOOKING_MIN_NOTICE_HOURS',
      defaultValue: DEMO_BOOKING_CONFIG_DEFAULTS.minNoticeHours,
      min: MIN_NOTICE_HOURS_BOUNDS.min,
      max: MIN_NOTICE_HOURS_BOUNDS.max,
      warn,
    }),
    adminEmail: env.DEMO_BOOKING_ADMIN_EMAIL || null,
  };
}

// "YYYY-MM-DD" for a Date in the config's timezone rather than the server's (which may not be IST).
function dateKeyInTimezone(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function isoWeekdayInTimezone(date, timezone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[weekday];
}

/**
 * Is `dateStr` ("YYYY-MM-DD") a bookable day, ignoring taken slots? It must be a valid calendar date, a
 * configured work day, and within [today, today + lookaheadDays] in the configured timezone.
 */
function isBookableDate(dateStr, config, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const todayKey = dateKeyInTimezone(now, config.timezone);
  const lastBookableDate = new Date(now.getTime() + config.lookaheadDays * 24 * 60 * 60 * 1000);
  const lastBookableKey = dateKeyInTimezone(lastBookableDate, config.timezone);
  if (dateStr < todayKey || dateStr > lastBookableKey) return false;

  // A plain UTC-noon anchor is enough just to ask "which weekday is this
  // calendar date" — we're not deriving a wall-clock instant from it.
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return false;
  return config.workDays.includes(isoWeekdayInTimezone(anchor, config.timezone));
}

/**
 * Every "HH:MM" slot start from config.startTime up to endTime (excluding a start that would run past it),
 * ignoring bookings; callers filter out taken and past-cutoff slots.
 */
function generateSlotStarts(config) {
  const [startH, startM] = config.startTime.split(':').map(Number);
  const [endH, endM] = config.endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const slots = [];
  for (let minutes = startMinutes; minutes + config.slotMinutes <= endMinutes; minutes += config.slotMinutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}

/**
 * The offset of `timeZone` from UTC at `instant`, in ms (positive when ahead of UTC). Uses
 * `Intl.DateTimeFormat.formatToParts` rather than `new Date(localeString)`, which would re-parse using the
 * server's own timezone.
 */
function timeZoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/**
 * Converts a "YYYY-MM-DD" + "HH:MM" wall-clock pair in `timeZone` to the UTC instant it represents. Good
 * enough for scheduling; not precise across DST boundaries (Asia/Kolkata has none).
 */
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  // The wall-clock digits read as a UTC instant, used only as a reference for the zone's offset and calendar digits.
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetMs = timeZoneOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMs);
}

/** Is `date`+`startTime` far enough in the future to satisfy minNoticeHours? */
function meetsMinNotice(dateStr, startTime, config, now = new Date()) {
  const slotInstant = zonedTimeToUtc(dateStr, startTime, config.timezone);
  const hoursUntilSlot = (slotInstant.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hoursUntilSlot >= config.minNoticeHours;
}

// "2026-09-30" -> "Wednesday, 30 September 2026"; shared by the public and admin routes so dates read alike.
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// "14:00" -> "2:00 PM IST".
function formatTimeLabel(startTime, config) {
  const [h, m] = startTime.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const zoneAbbrev = config.timezone === 'Asia/Kolkata' ? 'IST' : config.timezone;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix} ${zoneAbbrev}`;
}

module.exports = {
  DEMO_BOOKING_CONFIG_DEFAULTS,
  getDemoBookingConfig,
  isBookableDate,
  generateSlotStarts,
  meetsMinNotice,
  zonedTimeToUtc,
  dateKeyInTimezone,
  formatDateLabel,
  formatTimeLabel,
};
