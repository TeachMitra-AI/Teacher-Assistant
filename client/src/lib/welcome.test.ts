import { describe, expect, test } from 'vitest';
import {
  getGreetingPeriod,
  getSubtitle,
  getWelcomeGreeting,
  getDailyHighlight,
} from './welcome';
import { getSpecialDay, FIXED_SPECIAL_DAYS, YEAR_SPECIFIC_SPECIAL_DAYS } from './specialDays';
import { getDailyFact, DAILY_FACTS } from './dailyContent';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 5, 10, hour, minute);
}

function on(month: number, day: number, hour = 9, year = 2026): Date {
  return new Date(year, month - 1, day, hour);
}

describe('getGreetingPeriod', () => {
  test('early morning is night', () => {
    expect(getGreetingPeriod(at(4, 59))).toBe('night');
  });
  test('5am starts morning', () => {
    expect(getGreetingPeriod(at(5))).toBe('morning');
  });
  test('11:59 is still morning', () => {
    expect(getGreetingPeriod(at(11, 59))).toBe('morning');
  });
  test('noon starts afternoon', () => {
    expect(getGreetingPeriod(at(12))).toBe('afternoon');
  });
  test('5pm starts evening', () => {
    expect(getGreetingPeriod(at(17))).toBe('evening');
  });
  test('9pm starts night', () => {
    expect(getGreetingPeriod(at(21))).toBe('night');
  });
  test('midnight is night', () => {
    expect(getGreetingPeriod(at(0))).toBe('night');
  });
});

describe('getWelcomeGreeting', () => {
  test('includes the name when present', () => {
    expect(getWelcomeGreeting('Asha', at(8)).greeting).toBe('Good morning, Asha 👋');
  });
  test('omits the comma when name is empty', () => {
    expect(getWelcomeGreeting('', at(8)).greeting).toBe('Good morning 👋');
  });
  test('uses the special-day greeting on a recognised date, not the rotating subtitle', () => {
    const result = getWelcomeGreeting('Asha', on(8, 15, 8));
    expect(result.subtitle).toBe(FIXED_SPECIAL_DAYS.find((s) => s.id === 'independence-day')!.greeting);
  });
  test('is deterministic for the same date', () => {
    const a = getWelcomeGreeting('Asha', on(3, 1, 10));
    const b = getWelcomeGreeting('Asha', on(3, 1, 10));
    expect(a).toEqual(b);
  });
});

describe('getSpecialDay — fixed-date special days', () => {
  test('matches Independence Day by month/day regardless of year', () => {
    expect(getSpecialDay(new Date(1999, 7, 15))?.id).toBe('independence-day');
    expect(getSpecialDay(new Date(2031, 7, 15))?.id).toBe('independence-day');
  });
  test('matches Republic Day (26 January)', () => {
    expect(getSpecialDay(on(1, 26))?.id).toBe('republic-day');
  });
  test("matches Teachers' Day (5 September)", () => {
    expect(getSpecialDay(on(9, 5))?.id).toBe('teachers-day');
  });
  test('returns null on a normal day', () => {
    expect(getSpecialDay(on(3, 15))).toBeNull();
  });
  test('every fixed special day is matched on its own date', () => {
    for (const day of FIXED_SPECIAL_DAYS) {
      expect(getSpecialDay(on(day.month, day.day))?.id).toBe(day.id);
    }
  });
  test('a fixed special day is unaffected by a leap year', () => {
    // 2028 is a leap year; Independence Day (15 August) is well after 29
    // February, so if the lookup were dayOfYear-based it would be exactly
    // one position off from a non-leap year. Month/day lookup is immune.
    expect(getSpecialDay(new Date(2028, 7, 15))?.id).toBe('independence-day');
  });
});

describe('getSpecialDay — movable (year-specific) festivals', () => {
  test('resolves a movable festival for a year that has data (Diwali 2026)', () => {
    const entry = YEAR_SPECIFIC_SPECIAL_DAYS[2026].find((s) => s.id === 'diwali-2026')!;
    expect(getSpecialDay(new Date(2026, entry.month - 1, entry.day))?.id).toBe('diwali-2026');
  });
  test('the same movable festival falls on a DIFFERENT date in a different year', () => {
    const holi2025 = YEAR_SPECIFIC_SPECIAL_DAYS[2025].find((s) => s.id === 'holi-2025')!;
    const holi2026 = YEAR_SPECIFIC_SPECIAL_DAYS[2026].find((s) => s.id === 'holi-2026')!;
    expect(`${holi2025.month}-${holi2025.day}`).not.toBe(`${holi2026.month}-${holi2026.day}`);
  });
  test('a year with no configured data gracefully falls through to normal daily content, never a guess', () => {
    // 2030 has no entry in YEAR_SPECIFIC_SPECIAL_DAYS — this must not throw,
    // and must not fabricate a festival date.
    expect(getSpecialDay(new Date(2030, 2, 14))).toBeNull();
  });
  test('a fixed civic day is not silently displaced by a movable festival landing on the same date', () => {
    // Onam 2025 falls on 5 September, the same date as Teachers' Day (fixed).
    // The fixed day must win.
    expect(getSpecialDay(on(9, 5, 9, 2025))?.id).toBe('teachers-day');
  });
});

describe('getDailyFact / getSubtitle', () => {
  test('is deterministic for the same date', () => {
    expect(getDailyFact(on(2, 3))).toEqual(getDailyFact(on(2, 3)));
    expect(getSubtitle(on(2, 3))).toEqual(getSubtitle(on(2, 3)));
  });
  test('always returns a value from the configured table', () => {
    const fact = getDailyFact(on(4, 20));
    expect(DAILY_FACTS.some((f) => f.id === fact.id)).toBe(true);
  });
  test('different dates map to different entries where content exists', () => {
    const a = getDailyFact(on(4, 20));
    const b = getDailyFact(on(9, 3));
    expect(a.id).not.toBe(b.id);
  });
  test('a fixed month/day date is NOT shifted by a leap year (no dayOfYear drift)', () => {
    // 16 August sits after 29 February. Under a dayOfYear-modulo scheme,
    // a leap year would shift this date's index by one relative to a
    // non-leap year. Under month/day keying, it must be identical.
    const nonLeap = getDailyFact(new Date(2026, 7, 16)); // 2026 is not a leap year
    const leap = getDailyFact(new Date(2028, 7, 16)); // 2028 is a leap year
    expect(leap.id).toBe(nonLeap.id);
  });
  test('29 February has its own dedicated entry', () => {
    const fact = getDailyFact(new Date(2028, 1, 29));
    expect(fact.id).toBe('leap-day');
  });
});

describe('getDailyHighlight', () => {
  test('special-day content takes priority over a normal fact/thought (15 August)', () => {
    const highlight = getDailyHighlight(on(8, 15));
    expect(highlight.kind).toBe('special');
    expect(highlight.summary).toContain('Independence Day');
  });
  test('special-day content for Republic Day (26 January)', () => {
    const highlight = getDailyHighlight(on(1, 26));
    expect(highlight.kind).toBe('special');
    expect(highlight.summary).toContain('Republic Day');
  });
  test("special-day content for Teachers' Day (5 September)", () => {
    const highlight = getDailyHighlight(on(9, 5));
    expect(highlight.kind).toBe('special');
    expect(highlight.detailTitle).toContain("Teachers' Day");
  });
  test('special-day content for a movable festival (Diwali 2026)', () => {
    const entry = YEAR_SPECIFIC_SPECIAL_DAYS[2026].find((s) => s.id === 'diwali-2026')!;
    const highlight = getDailyHighlight(new Date(2026, entry.month - 1, entry.day));
    expect(highlight.kind).toBe('special');
    expect(highlight.detailTitle).toContain('Diwali');
  });
  test('falls back to a fact/thought on a normal day', () => {
    const highlight = getDailyHighlight(on(3, 15));
    expect(['fact', 'thought']).toContain(highlight.kind);
  });
  test('a normal-day highlight is never shown alongside special-day content — only one is ever returned', () => {
    const highlight = getDailyHighlight(on(8, 15));
    // On Independence Day, the highlight must be exactly the special-day
    // variant — not a fact/thought, confirming no double-rendering path.
    expect(highlight.kind).not.toBe('fact');
    expect(highlight.kind).not.toBe('thought');
  });
  test('is deterministic for the same date', () => {
    expect(getDailyHighlight(on(3, 15))).toEqual(getDailyHighlight(on(3, 15)));
  });
});
