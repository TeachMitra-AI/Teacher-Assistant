import { describe, expect, test } from 'vitest';
import { addDays, addMonths, formatDateLabel, formatMonthLabel, toDateString } from './classroomDate';

describe('classroomDate', () => {
  test('toDateString pads month and day to two digits', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateString(new Date(2026, 10, 30))).toBe('2026-11-30');
  });

  test('addDays walks forward and backward, including across a month boundary', () => {
    expect(addDays('2026-08-16', 1)).toBe('2026-08-17');
    expect(addDays('2026-08-16', -1)).toBe('2026-08-15');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  test('addMonths walks forward and backward, including across a year boundary', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09');
    expect(addMonths('2026-08', -1)).toBe('2026-07');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  test('formatDateLabel and formatMonthLabel produce a human-readable label', () => {
    expect(formatDateLabel('2026-08-16')).toMatch(/2026/);
    expect(formatDateLabel('2026-08-16')).toMatch(/16/);
    expect(formatMonthLabel('2026-08')).toMatch(/2026/);
    expect(formatMonthLabel('2026-08')).toMatch(/Aug/);
  });
});
