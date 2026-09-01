import { describe, expect, test } from 'vitest';
import { formatDuration, formatDistance } from './teacherAttendanceLabels';

describe('formatDuration', () => {
  test('a whole number of hours has no minutes shown', () => {
    expect(formatDuration(420)).toBe('7h');
    expect(formatDuration(60)).toBe('1h');
  });

  test('hours and minutes both show when there is a remainder', () => {
    expect(formatDuration(65)).toBe('1h 5m');
    expect(formatDuration(125)).toBe('2h 5m');
  });

  test('under an hour shows minutes only, no "0h"', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(1)).toBe('1m');
  });

  test('zero shows as "0m", not blank', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  test('null (no value yet) shows as an em dash, not "NaN" or blank', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('formatDistance', () => {
  test('under 1000m stays in metres, rounded to a whole number', () => {
    expect(formatDistance(600)).toBe('600m');
    expect(formatDistance(45.4)).toBe('45m');
  });

  test('1000m and above switches to kilometres', () => {
    expect(formatDistance(1600)).toBe('1.6km');
    expect(formatDistance(1000)).toBe('1km'); // whole km, no trailing ".0"
    expect(formatDistance(2050)).toBe('2.1km' /* rounds to nearest 0.1km */);
  });

  test('exactly at the 1000m boundary is already kilometres, not "1000m"', () => {
    expect(formatDistance(999)).toBe('999m');
    expect(formatDistance(1000)).toBe('1km');
  });

  test('null shows as an em dash', () => {
    expect(formatDistance(null)).toBe('—');
  });
});
