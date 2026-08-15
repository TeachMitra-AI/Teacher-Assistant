import { describe, expect, test } from 'vitest';
import {
  getGreetingPeriod,
  getSpecialDay,
  getDailyFact,
  getSubtitle,
  getWelcomeGreeting,
  getDailyHighlight,
  SPECIAL_DAYS,
  DAILY_FACTS,
} from './welcome';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 5, 10, hour, minute);
}

function on(month: number, day: number, hour = 9): Date {
  return new Date(2026, month - 1, day, hour);
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
    expect(result.subtitle).toBe(SPECIAL_DAYS.find((s) => s.id === 'independence-day')!.greeting);
  });
  test('is deterministic for the same date', () => {
    const a = getWelcomeGreeting('Asha', on(3, 1, 10));
    const b = getWelcomeGreeting('Asha', on(3, 1, 10));
    expect(a).toEqual(b);
  });
});

describe('getSpecialDay', () => {
  test('matches Independence Day by month/day regardless of year', () => {
    expect(getSpecialDay(new Date(1999, 7, 15))?.id).toBe('independence-day');
    expect(getSpecialDay(new Date(2031, 7, 15))?.id).toBe('independence-day');
  });
  test('returns null on a normal day', () => {
    expect(getSpecialDay(on(3, 15))).toBeNull();
  });
  test('every configured special day is matched on its own date', () => {
    for (const day of SPECIAL_DAYS) {
      expect(getSpecialDay(on(day.month, day.day))?.id).toBe(day.id);
    }
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
});

describe('getDailyHighlight', () => {
  test('special-day content takes priority over a normal fact/thought', () => {
    const highlight = getDailyHighlight(on(8, 15));
    expect(highlight.kind).toBe('special');
    expect(highlight.summary).toContain('Independence Day');
  });
  test('falls back to a fact/thought on a normal day', () => {
    const highlight = getDailyHighlight(on(3, 15));
    expect(['fact', 'thought']).toContain(highlight.kind);
  });
  test('is deterministic for the same date', () => {
    expect(getDailyHighlight(on(3, 15))).toEqual(getDailyHighlight(on(3, 15)));
  });
});
