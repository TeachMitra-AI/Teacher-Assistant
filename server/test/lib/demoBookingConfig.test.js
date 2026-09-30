// Regression coverage for the timezone math in lib/demoBookingConfig.js. zonedTimeToUtc used `new Date(someLocaleString)`
// to measure a zone's offset, which re-parses the string in the server process's own timezone, so it was right only
// when the host's timezone matched the target (Asia/Kolkata). These assertions pin the absolute UTC instant, which
// must hold whatever timezone the runner is in.
const { zonedTimeToUtc, generateSlotStarts, isBookableDate } = require('../../src/lib/demoBookingConfig');

describe('zonedTimeToUtc', () => {
  test('2:00 PM IST is 8:30 AM UTC', () => {
    const result = zonedTimeToUtc('2026-09-29', '14:00', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2026-09-29T08:30:00.000Z');
  });

  test('10:00 AM IST is 4:30 AM UTC (fractional +05:30 offset)', () => {
    const result = zonedTimeToUtc('2026-01-15', '10:00', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2026-01-15T04:30:00.000Z');
  });

  test('midnight IST rolls back to the previous UTC day', () => {
    const result = zonedTimeToUtc('2026-09-29', '00:00', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2026-09-28T18:30:00.000Z');
  });

  test('is a no-op for the UTC zone itself', () => {
    const result = zonedTimeToUtc('2026-09-29', '14:00', 'UTC');
    expect(result.toISOString()).toBe('2026-09-29T14:00:00.000Z');
  });
});

describe('generateSlotStarts', () => {
  test('produces IST wall-clock slots at the configured cadence', () => {
    const slots = generateSlotStarts({ startTime: '10:00', endTime: '11:30', slotMinutes: 30 });
    expect(slots).toEqual(['10:00', '10:30', '11:00']);
  });
});

describe('isBookableDate', () => {
  const config = { workDays: [1, 2, 3, 4, 5], lookaheadDays: 21, timezone: 'Asia/Kolkata' };

  test('rejects a malformed date string', () => {
    expect(isBookableDate('not-a-date', config, new Date('2026-09-27T12:00:00Z'))).toBe(false);
  });

  test('rejects a Saturday/Sunday', () => {
    // 2026-10-03 is a Saturday.
    expect(isBookableDate('2026-10-03', config, new Date('2026-09-27T12:00:00Z'))).toBe(false);
  });

  test('accepts a weekday within the lookahead window', () => {
    // 2026-09-29 is a Tuesday.
    expect(isBookableDate('2026-09-29', config, new Date('2026-09-27T12:00:00Z'))).toBe(true);
  });

  test('rejects a date beyond the lookahead window', () => {
    expect(isBookableDate('2026-12-01', config, new Date('2026-09-27T12:00:00Z'))).toBe(false);
  });
});
