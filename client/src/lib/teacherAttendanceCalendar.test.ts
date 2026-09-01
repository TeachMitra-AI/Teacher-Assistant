import { describe, expect, test } from 'vitest';
import { isWeeklyOffDate, buildMonthDates } from './teacherAttendanceCalendar';

describe('isWeeklyOffDate', () => {
  // 2026-08-29 is a Saturday, 2026-08-30 a Sunday, 2026-08-31 a Monday.
  test('the default "0" (Sunday only) flags Sunday, not Monday', () => {
    expect(isWeeklyOffDate('2026-08-30', '0')).toBe(true);
    expect(isWeeklyOffDate('2026-08-31', '0')).toBe(false);
  });

  test('"0,6" (Sunday and Saturday off) flags both', () => {
    expect(isWeeklyOffDate('2026-08-30', '0,6')).toBe(true);
    expect(isWeeklyOffDate('2026-08-29', '0,6')).toBe(true);
    expect(isWeeklyOffDate('2026-08-31', '0,6')).toBe(false);
  });

  test('an empty string means no weekly off day at all — never true', () => {
    expect(isWeeklyOffDate('2026-08-30', '')).toBe(false);
  });
});

describe('buildMonthDates', () => {
  test('a past, fully-elapsed month lists every day', () => {
    const dates = buildMonthDates('2026-02', '2026-08-29');
    expect(dates).toHaveLength(28); // 2026 is not a leap year
    expect(dates[0]).toBe('2026-02-01');
    expect(dates[dates.length - 1]).toBe('2026-02-28');
  });

  test('the current month in progress stops at today, not the end of the month', () => {
    const dates = buildMonthDates('2026-08', '2026-08-29');
    expect(dates[dates.length - 1]).toBe('2026-08-29');
    expect(dates).toHaveLength(29);
  });

  test('a leap-year February gets all 29 days', () => {
    const dates = buildMonthDates('2028-02', '2028-08-01');
    expect(dates).toHaveLength(29);
    expect(dates[dates.length - 1]).toBe('2028-02-29');
  });

  test('a month entirely before sinceDate is skipped — no Absent days before tracking started', () => {
    const dates = buildMonthDates('2026-06', '2026-08-29', '2026-08-29');
    expect(dates).toHaveLength(0);
  });

  test('the month sinceDate falls in starts partway through, not from the 1st', () => {
    const dates = buildMonthDates('2026-08', '2026-08-29', '2026-08-29');
    expect(dates).toEqual(['2026-08-29']);
  });

  test('a month entirely after sinceDate is unaffected', () => {
    const dates = buildMonthDates('2026-02', '2026-08-29', '2026-01-01');
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe('2026-02-01');
  });
});
