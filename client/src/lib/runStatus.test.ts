import { describe, expect, test } from 'vitest';
import { formatElapsed, waitingMessage } from './runStatus';

describe('formatElapsed', () => {
  test('counts seconds, zero-padded', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_000)).toBe('0:07');
    expect(formatElapsed(59_000)).toBe('0:59');
  });

  test('rolls over into minutes', () => {
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(63_400)).toBe('1:03');
    expect(formatElapsed(605_000)).toBe('10:05');
  });

  test('floors part-seconds rather than rounding up', () => {
    // Otherwise the timer would show 0:01 the instant it mounts.
    expect(formatElapsed(999)).toBe('0:00');
  });

  // A clock that jumps backwards (system time change, or a stale startedAt)
  // must not render "-1:-3".
  test('never renders a negative time', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('waitingMessage', () => {
  test('opens with the line this app has always shown', () => {
    expect(waitingMessage(0)).toBe('Preparing practical advice for you…');
    expect(waitingMessage(9_999)).toBe('Preparing practical advice for you…');
  });

  test('acknowledges the wait at ten seconds', () => {
    expect(waitingMessage(10_000)).toContain('Still working');
  });

  test('says so plainly once it is genuinely slow', () => {
    expect(waitingMessage(25_000)).toContain('longer than usual');
    expect(waitingMessage(120_000)).toContain('longer than usual');
  });

  test('changes at most twice, so the live region is not noisy', () => {
    const seen = new Set<string>();
    for (let ms = 0; ms <= 120_000; ms += 500) seen.add(waitingMessage(ms));
    expect(seen.size).toBe(3);
  });
});
