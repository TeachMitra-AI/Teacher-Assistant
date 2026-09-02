// Pins the worked examples from docs/attendance-plan-review.md §4/§5 down as
// exact, deterministic tests — this is where the review doc's numbers stop
// being prose and become the actual spec.

const {
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
} = require('../../src/lib/teacherAttendance');

// Builds a UTC Date whose IST wall-clock time is hh:mm, on a fixed
// reference date. Only time-of-day matters to every function under test
// (school hours never cross the UTC day boundary once shifted by +5:30), so
// the calendar date itself is arbitrary and fixed for reproducibility.
function istTime(hours, minutes) {
  const istMinutesOfDay = hours * 60 + minutes;
  const utcMinutesOfDay = (istMinutesOfDay - (5 * 60 + 30) + 1440) % 1440;
  return new Date(Date.UTC(2026, 0, 1, Math.floor(utcMinutesOfDay / 60), utcMinutesOfDay % 60));
}

// The exact worked-example config from attendance-plan-review.md §5's
// "config note": opens 9:00, closes 16:00, check-in window 8:30–10:00,
// half-day 50%, full-day grace 15 min, early-departure grace 15 min, and
// late grace deliberately 0 — the doc states its examples use no grace so
// the numbers stay literal, and separately recommends 10 min as the real
// production default (tested on its own below).
const EXAMPLE_CONFIG = {
  openTime: '09:00',
  closeTime: '16:00',
  checkinWindowStart: '08:30',
  checkinWindowEnd: '10:00',
  lateGraceMinutes: 0,
  halfDayThresholdPercent: 50,
  fullDayGraceMinutes: 15,
  geofenceRadiusMeters: 180,
};

describe('timeStringToMinutes', () => {
  test('parses HH:MM into minutes since midnight', () => {
    expect(timeStringToMinutes('09:00')).toBe(540);
    expect(timeStringToMinutes('16:00')).toBe(960);
    expect(timeStringToMinutes('00:00')).toBe(0);
    expect(timeStringToMinutes('23:59')).toBe(1439);
  });

  test('rejects a malformed time string rather than silently misparsing it', () => {
    expect(() => timeStringToMinutes('9am')).toThrow();
    expect(() => timeStringToMinutes('25:00')).toThrow();
    expect(() => timeStringToMinutes('')).toThrow();
  });
});

describe('utcDateToIstMinutesOfDay / istTime helper round-trip', () => {
  test('9:00 AM IST round-trips through the test helper correctly', () => {
    expect(utcDateToIstMinutesOfDay(istTime(9, 0))).toBe(540);
  });

  test('4:00 PM IST round-trips through the test helper correctly', () => {
    expect(utcDateToIstMinutesOfDay(istTime(16, 0))).toBe(960);
  });
});

describe('computeRequiredMinutes', () => {
  test('9:00–16:00 is 420 minutes (7 hours), matching the review doc example', () => {
    expect(computeRequiredMinutes(EXAMPLE_CONFIG)).toBe(420);
  });
});

// attendance-plan-review.md §5, examples 1–4 — arrival classification.
describe('classifyArrival — the review doc\'s four arrival examples', () => {
  test('example 1: 8:40 AM is on time (before opening, inside the window)', () => {
    const result = classifyArrival(istTime(8, 40), EXAMPLE_CONFIG);
    expect(result).toEqual({ classification: 'on_time', lateMinutes: 0 });
  });

  test('example 2: 9:05 AM is Late by 5 minutes', () => {
    const result = classifyArrival(istTime(9, 5), EXAMPLE_CONFIG);
    expect(result).toEqual({ classification: 'late', lateMinutes: 5 });
  });

  test('example 3: 9:45 AM is Late by 45 minutes', () => {
    const result = classifyArrival(istTime(9, 45), EXAMPLE_CONFIG);
    expect(result).toEqual({ classification: 'late', lateMinutes: 45 });
  });

  test('example 4: 10:30 AM is outside the check-in window — held for review, not auto-Present', () => {
    const result = classifyArrival(istTime(10, 30), EXAMPLE_CONFIG);
    expect(result.classification).toBe('outside_window');
  });

  test('arriving exactly at the window close (10:00) is still inside the window, not outside it', () => {
    expect(classifyArrival(istTime(10, 0), EXAMPLE_CONFIG).classification).not.toBe('outside_window');
  });

  test('arriving exactly at opening time is on time, not late', () => {
    expect(classifyArrival(istTime(9, 0), EXAMPLE_CONFIG).classification).toBe('on_time');
  });

  test('with a 10-minute grace period, 9:05 counts as on time but still reports the raw 5-minute delay', () => {
    const config = { ...EXAMPLE_CONFIG, lateGraceMinutes: 10 };
    expect(classifyArrival(istTime(9, 5), config)).toEqual({ classification: 'on_time', lateMinutes: 5 });
  });

  test('with a 10-minute grace period, 9:15 is late — grace decides classification, not the reported minutes', () => {
    const config = { ...EXAMPLE_CONFIG, lateGraceMinutes: 10 };
    expect(classifyArrival(istTime(9, 15), config)).toEqual({ classification: 'late', lateMinutes: 15 });
  });

  // Decided rule: check-in has no earliest time at all, only a latest one
  // (checkinWindowEnd) — arriving hours before opening (e.g. 1:16 AM) is
  // never blocked on its own; only the location requirement (checked
  // separately, at the route level) and the window's close matter.
  test('arriving hours before opening (1:16 AM) is still on time, not outside the window', () => {
    const result = classifyArrival(istTime(1, 16), EXAMPLE_CONFIG);
    expect(result.classification).toBe('on_time');
    expect(result.lateMinutes).toBe(0);
  });
});

describe('computeWorkingMinutes', () => {
  test('example 5: 9:00 in, 3:00 PM out is 360 minutes (6 hours)', () => {
    expect(computeWorkingMinutes(istTime(9, 0), istTime(15, 0))).toBe(360);
  });

  test('example 6: 9:00 in, 4:00 PM out is 420 minutes (7 hours)', () => {
    expect(computeWorkingMinutes(istTime(9, 0), istTime(16, 0))).toBe(420);
  });
});

describe('deriveDayStatus', () => {
  test('example 5: 360 of 420 required minutes is present-with-shortfall, short by 60', () => {
    expect(deriveDayStatus(360, 420, EXAMPLE_CONFIG)).toEqual({
      dayStatus: 'present_shortfall',
      shortfallMinutes: 60,
    });
  });

  test('example 6: 420 of 420 required minutes is a full day with no shortfall', () => {
    expect(deriveDayStatus(420, 420, EXAMPLE_CONFIG)).toEqual({ dayStatus: 'full_day', shortfallMinutes: 0 });
  });

  test('the full-day grace means being within 15 minutes of required still counts as a full day', () => {
    expect(deriveDayStatus(405, 420, EXAMPLE_CONFIG).dayStatus).toBe('full_day');
    expect(deriveDayStatus(404, 420, EXAMPLE_CONFIG).dayStatus).toBe('present_shortfall');
  });

  test('below the 50% half-day threshold is a half day', () => {
    expect(deriveDayStatus(200, 420, EXAMPLE_CONFIG).dayStatus).toBe('half_day');
    expect(deriveDayStatus(210, 420, EXAMPLE_CONFIG).dayStatus).toBe('present_shortfall'); // exactly 50%
  });
});

// attendance-plan-review.md §5, example 8 ("checks out early, e.g. 2:00 PM").
describe('computeEarlyDeparture', () => {
  test('example 5: checking out at 3:00 PM (closing 4:00 PM) is 60 minutes early', () => {
    expect(computeEarlyDeparture(istTime(15, 0), EXAMPLE_CONFIG)).toEqual({ isEarly: true, earlyMinutes: 60 });
  });

  test('example 6: checking out exactly at closing time is not early', () => {
    expect(computeEarlyDeparture(istTime(16, 0), EXAMPLE_CONFIG)).toEqual({ isEarly: false, earlyMinutes: 0 });
  });

  test('example 8: checking out at 2:00 PM is 120 minutes early', () => {
    expect(computeEarlyDeparture(istTime(14, 0), EXAMPLE_CONFIG)).toEqual({ isEarly: true, earlyMinutes: 120 });
  });

  test('leaving within the 15-minute grace before closing is not flagged as early', () => {
    expect(computeEarlyDeparture(istTime(15, 50), EXAMPLE_CONFIG).isEarly).toBe(false);
  });
});

describe('distanceMeters', () => {
  test('the same point is zero metres from itself', () => {
    expect(distanceMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 6);
  });

  test('one degree of latitude is approximately 111km, sanity-checking the haversine formula', () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111320, -3);
  });
});

describe('istDateString', () => {
  test('a normal midday UTC timestamp reads as the same IST calendar date', () => {
    // 2026-08-29T09:00:00Z is 2026-08-29 14:30 IST — same day either way.
    expect(istDateString(new Date('2026-08-29T09:00:00.000Z'))).toBe('2026-08-29');
  });

  test('the IST date can be a day ahead of the UTC date, near UTC midnight', () => {
    // 2026-08-29T19:00:00Z (7 PM UTC) is 2026-08-30 00:30 IST — already the
    // 30th in IST while still the 29th in UTC.
    expect(istDateString(new Date('2026-08-29T19:00:00.000Z'))).toBe('2026-08-30');
  });
});

describe('istDayOfWeek', () => {
  test('reads the correct IST weekday — 29 Aug 2026 is a Saturday', () => {
    expect(istDayOfWeek(new Date('2026-08-29T06:30:00.000Z'))).toBe(6); // noon IST
  });

  test('29 -> 30 -> 31 Aug 2026 is Saturday -> Sunday -> Monday', () => {
    expect(istDayOfWeek(new Date('2026-08-29T06:30:00.000Z'))).toBe(6);
    expect(istDayOfWeek(new Date('2026-08-30T06:30:00.000Z'))).toBe(0);
    expect(istDayOfWeek(new Date('2026-08-31T06:30:00.000Z'))).toBe(1);
  });
});

describe('isWeeklyOff', () => {
  const SUNDAY_NOON = new Date('2026-08-30T06:30:00.000Z');
  const MONDAY_NOON = new Date('2026-08-31T06:30:00.000Z');
  const SATURDAY_NOON = new Date('2026-08-29T06:30:00.000Z');

  test('the default "0" (Sunday only) flags Sunday, not Monday', () => {
    expect(isWeeklyOff(SUNDAY_NOON, { weeklyOffDays: '0' })).toBe(true);
    expect(isWeeklyOff(MONDAY_NOON, { weeklyOffDays: '0' })).toBe(false);
  });

  test('"0,6" (Sunday and Saturday off) flags both', () => {
    expect(isWeeklyOff(SUNDAY_NOON, { weeklyOffDays: '0,6' })).toBe(true);
    expect(isWeeklyOff(SATURDAY_NOON, { weeklyOffDays: '0,6' })).toBe(true);
    expect(isWeeklyOff(MONDAY_NOON, { weeklyOffDays: '0,6' })).toBe(false);
  });

  test('an empty string means no weekly off days at all', () => {
    expect(isWeeklyOff(SUNDAY_NOON, { weeklyOffDays: '' })).toBe(false);
  });

  test('tolerates stray whitespace in the stored value ("0, 6")', () => {
    expect(isWeeklyOff(SATURDAY_NOON, { weeklyOffDays: '0, 6' })).toBe(true);
  });
});

describe('deriveEffectiveStatus', () => {
  test('a past day with a check-in but no check-out reads as pending_regularization', () => {
    const record = { status: 'present', checkOutAt: null, date: '2026-08-20' };
    expect(deriveEffectiveStatus(record, '2026-08-29')).toBe('pending_regularization');
  });

  test('today with no check-out yet is NOT pending — the day isn\'t over', () => {
    const record = { status: 'present', checkOutAt: null, date: '2026-08-29' };
    expect(deriveEffectiveStatus(record, '2026-08-29')).toBe('present');
  });

  test('a past day that does have a check-out keeps its stored status', () => {
    const record = { status: 'full_day', checkOutAt: new Date(), date: '2026-08-20' };
    expect(deriveEffectiveStatus(record, '2026-08-29')).toBe('full_day');
  });

  test('a past day with no check-out, but already reviewed, keeps its stored status — the review resolved it', () => {
    const record = { status: 'present', checkOutAt: null, date: '2026-08-20', wasReviewed: true };
    expect(deriveEffectiveStatus(record, '2026-08-29')).toBe('present');
  });

  test('a past day with no check-out and no review is still pending, even after a status write attempt', () => {
    const record = { status: 'on_leave', checkOutAt: null, date: '2026-08-20', wasReviewed: false };
    expect(deriveEffectiveStatus(record, '2026-08-29')).toBe('pending_regularization');
  });
});

describe('isWithinGeofence', () => {
  test('a distance under the radius is inside the geofence', () => {
    expect(isWithinGeofence(100, EXAMPLE_CONFIG)).toBe(true);
  });

  test('a distance exactly at the radius counts as inside (inclusive boundary)', () => {
    expect(isWithinGeofence(180, EXAMPLE_CONFIG)).toBe(true);
  });

  test('a distance just past the radius is outside the geofence', () => {
    expect(isWithinGeofence(180.1, EXAMPLE_CONFIG)).toBe(false);
  });
});

describe('isImplausiblyShortDay', () => {
  test('a check-in immediately followed by a check-out is implausibly short', () => {
    expect(isImplausiblyShortDay(5)).toBe(true);
  });

  test('exactly the floor is not implausibly short (inclusive boundary)', () => {
    expect(isImplausiblyShortDay(MINIMUM_PLAUSIBLE_WORKING_MINUTES)).toBe(false);
  });

  test('one minute under the floor is implausibly short', () => {
    expect(isImplausiblyShortDay(MINIMUM_PLAUSIBLE_WORKING_MINUTES - 1)).toBe(true);
  });

  test('a normal short day (well under half-day, but a real amount of time) is not implausibly short', () => {
    expect(isImplausiblyShortDay(90)).toBe(false);
  });
});

describe('sinceDateFor (Reports/History floor)', () => {
  test('no config at all -> undefined', () => {
    expect(sinceDateFor(null, new Date('2026-01-01T00:00:00.000Z'))).toBeUndefined();
  });

  test('config newer than the person -> config wins', () => {
    const result = sinceDateFor(
      { createdAt: new Date('2026-08-29T10:00:00.000Z') },
      new Date('2026-01-01T00:00:00.000Z')
    );
    expect(result).toBe('2026-08-29');
  });

  test('person newer than the config (joined later) -> person wins', () => {
    const result = sinceDateFor(
      { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      new Date('2026-08-15T10:00:00.000Z')
    );
    expect(result).toBe('2026-08-15');
  });
});

describe('datesInMonth', () => {
  test('a past, fully-elapsed month lists every day', () => {
    const dates = datesInMonth('2026-02', '2026-08-29');
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe('2026-02-01');
    expect(dates[dates.length - 1]).toBe('2026-02-28');
  });

  test('the current month in progress stops at today', () => {
    const dates = datesInMonth('2026-08', '2026-08-29');
    expect(dates[dates.length - 1]).toBe('2026-08-29');
    expect(dates).toHaveLength(29);
  });

  test('a month entirely before sinceDate is skipped', () => {
    expect(datesInMonth('2026-06', '2026-08-29', '2026-08-29')).toHaveLength(0);
  });

  test('the month sinceDate falls in starts partway through', () => {
    expect(datesInMonth('2026-08', '2026-08-29', '2026-08-29')).toEqual(['2026-08-29']);
  });
});

describe('summarizeTeacherMonth', () => {
  const config = { weeklyOffDays: '0' }; // Sunday off

  test('counts each status once, and tallies late separately without double-counting the day', () => {
    const dates = ['2026-08-03', '2026-08-04', '2026-08-05']; // Mon, Tue, Wed
    const records = [
      { date: '2026-08-03', status: 'present', lateMinutes: 0 },
      { date: '2026-08-04', status: 'present', lateMinutes: 5 },
      { date: '2026-08-05', status: 'absent', lateMinutes: null },
    ];
    const summary = summarizeTeacherMonth(dates, records, config, new Set());
    expect(summary.present).toBe(2);
    expect(summary.late).toBe(1);
    expect(summary.absent).toBe(1);
  });

  test('a weekly-off day with no record is not counted as Absent', () => {
    const summary = summarizeTeacherMonth(['2026-08-02'], [], config, new Set()); // Sunday
    expect(summary.absent).toBe(0);
  });

  test('a holiday with no record is not counted as Absent', () => {
    const summary = summarizeTeacherMonth(['2026-08-06'], [], config, new Set(['2026-08-06'])); // Thursday
    expect(summary.absent).toBe(0);
  });

  test('a genuine no-record, non-off, non-holiday day counts as Absent', () => {
    const summary = summarizeTeacherMonth(['2026-08-06'], [], config, new Set()); // Thursday
    expect(summary.absent).toBe(1);
  });
});
