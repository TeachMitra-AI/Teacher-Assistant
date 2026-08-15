import { describe, expect, test } from 'vitest';
import { FIXED_SPECIAL_DAYS, YEAR_SPECIFIC_SPECIAL_DAYS, type SpecialDay } from './specialDays';

function allEntries(): SpecialDay[] {
  return [...FIXED_SPECIAL_DAYS, ...Object.values(YEAR_SPECIFIC_SPECIAL_DAYS).flat()];
}

describe('FIXED_SPECIAL_DAYS — structural validation', () => {
  test('no two fixed special days share the same month/day', () => {
    const seen = new Map<string, SpecialDay>();
    for (const s of FIXED_SPECIAL_DAYS) {
      const key = `${s.month}-${s.day}`;
      const clash = seen.get(key);
      expect(clash, `duplicate date ${key}: ${clash?.id} vs ${s.id}`).toBeUndefined();
      seen.set(key, s);
    }
  });

  test('every date is a valid month/day', () => {
    for (const s of FIXED_SPECIAL_DAYS) {
      expect(s.month, s.id).toBeGreaterThanOrEqual(1);
      expect(s.month, s.id).toBeLessThanOrEqual(12);
      expect(s.day, s.id).toBeGreaterThanOrEqual(1);
      expect(s.day, s.id).toBeLessThanOrEqual(31);
    }
  });

  test('no duplicate ids across fixed days', () => {
    const ids = FIXED_SPECIAL_DAYS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('YEAR_SPECIFIC_SPECIAL_DAYS — structural validation', () => {
  test('no two entries in the same year share the same month/day', () => {
    for (const [year, entries] of Object.entries(YEAR_SPECIFIC_SPECIAL_DAYS)) {
      const seen = new Map<string, SpecialDay>();
      for (const s of entries) {
        const key = `${s.month}-${s.day}`;
        const clash = seen.get(key);
        expect(clash, `${year}: duplicate date ${key} — ${clash?.id} vs ${s.id}`).toBeUndefined();
        seen.set(key, s);
      }
    }
  });

  test('every entry has a valid month/day', () => {
    for (const entries of Object.values(YEAR_SPECIFIC_SPECIAL_DAYS)) {
      for (const s of entries) {
        expect(s.month, s.id).toBeGreaterThanOrEqual(1);
        expect(s.month, s.id).toBeLessThanOrEqual(12);
        expect(s.day, s.id).toBeGreaterThanOrEqual(1);
        expect(s.day, s.id).toBeLessThanOrEqual(31);
      }
    }
  });

  test('no duplicate ids across the whole year-specific table', () => {
    const ids = Object.values(YEAR_SPECIFIC_SPECIAL_DAYS).flat().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every configured year is a real, plausible calendar year (sanity bound)', () => {
    for (const year of Object.keys(YEAR_SPECIFIC_SPECIAL_DAYS)) {
      expect(Number(year)).toBeGreaterThanOrEqual(2020);
      expect(Number(year)).toBeLessThanOrEqual(2035);
    }
  });
});

describe('all special-day content — shared checks', () => {
  test('every entry has non-empty greeting, highlightTitle and detailBody', () => {
    for (const s of allEntries()) {
      expect(s.greeting.trim().length, s.id).toBeGreaterThan(0);
      expect(s.highlightTitle.trim().length, s.id).toBeGreaterThan(0);
      expect(s.detailBody.trim().length, s.id).toBeGreaterThan(0);
    }
  });

  test('no duplicate ids across fixed AND year-specific tables combined', () => {
    const ids = allEntries().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
