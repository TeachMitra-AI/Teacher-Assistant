import { describe, expect, test } from 'vitest';
import { DAILY_FACTS, KIND_META, getDailyFact, type DailyFact } from './dailyContent';

// Days per month in a NON-leap year — 29 February is validated separately
// below as the one deliberate exception (a dedicated leap-day entry).
const DAYS_IN_MONTH: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

describe('DAILY_FACTS — content validation', () => {
  test('has exactly 366 entries: 365 calendar days plus one dedicated 29 February leap-day entry', () => {
    expect(DAILY_FACTS.length).toBe(366);
  });

  test('every month 1-12 has the correct number of entries, plus Feb has one extra for 29 Feb', () => {
    for (let month = 1; month <= 12; month++) {
      const entries = DAILY_FACTS.filter((f) => f.month === month);
      const expected = month === 2 ? DAYS_IN_MONTH[2] + 1 : DAYS_IN_MONTH[month];
      expect(entries.length, `month ${month}`).toBe(expected);
    }
  });

  test('no two entries share the same month/day (no duplicate calendar dates)', () => {
    const seen = new Map<string, DailyFact>();
    for (const f of DAILY_FACTS) {
      const key = `${f.month}-${f.day}`;
      const clash = seen.get(key);
      expect(clash, `duplicate date ${key}: ${clash?.id} vs ${f.id}`).toBeUndefined();
      seen.set(key, f);
    }
  });

  test('no duplicate ids', () => {
    const ids = DAILY_FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no duplicate summaries (case-insensitive, trimmed)', () => {
    const seen = new Map<string, string>();
    for (const f of DAILY_FACTS) {
      const key = f.summary.trim().toLowerCase();
      const clash = seen.get(key);
      expect(clash, `duplicate summary between ${clash} and ${f.id}`).toBeUndefined();
      seen.set(key, f.id);
    }
  });

  test('every date is a real calendar date (day within the month\'s valid range)', () => {
    for (const f of DAILY_FACTS) {
      expect(f.month, f.id).toBeGreaterThanOrEqual(1);
      expect(f.month, f.id).toBeLessThanOrEqual(12);
      const maxDay = f.month === 2 ? 29 : DAYS_IN_MONTH[f.month];
      expect(f.day, f.id).toBeGreaterThanOrEqual(1);
      expect(f.day, f.id).toBeLessThanOrEqual(maxDay);
    }
  });

  test('summaries stay concise enough for the homepage card (under 200 characters)', () => {
    for (const f of DAILY_FACTS) {
      expect(f.summary.length, f.id).toBeLessThan(200);
    }
  });

  test('every entry has a non-empty detailBody', () => {
    for (const f of DAILY_FACTS) {
      expect(f.detailBody.trim().length, f.id).toBeGreaterThan(0);
    }
  });

  test('kind is always "fact" or "thought"', () => {
    for (const f of DAILY_FACTS) {
      expect(['fact', 'thought']).toContain(f.kind);
    }
  });

  test('KIND_META covers both kinds with a non-empty eyebrow and emoji', () => {
    for (const kind of ['fact', 'thought'] as const) {
      expect(KIND_META[kind].eyebrow.length).toBeGreaterThan(0);
      expect(KIND_META[kind].emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('getDailyFact — full calendar coverage (no fallback ever triggers)', () => {
  test('every date from 1 Jan to 31 Dec 2026 resolves to an entry that actually matches that date', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const fact = getDailyFact(d);
      expect(fact.month, d.toDateString()).toBe(d.getMonth() + 1);
      expect(fact.day, d.toDateString()).toBe(d.getDate());
    }
  });

  test('29 February 2028 (a leap year) resolves to the dedicated leap-day entry', () => {
    expect(getDailyFact(new Date(2028, 1, 29)).id).toBe('leap-day');
  });
});
