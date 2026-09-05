import { describe, expect, test } from 'vitest';
import { formatRetryWait, retryMessage } from './retryCountdown';

describe('formatRetryWait', () => {
  test('shows seconds only under a minute', () => {
    expect(formatRetryWait(0)).toBe('0s');
    expect(formatRetryWait(38_000)).toBe('38s');
    expect(formatRetryWait(59_000)).toBe('59s');
  });

  test('shows minutes and seconds under an hour', () => {
    expect(formatRetryWait(60_000)).toBe('1m');
    expect(formatRetryWait(65_000)).toBe('1m 5s');
    expect(formatRetryWait(45 * 60_000)).toBe('45m');
  });

  test('shows hours and minutes at or above an hour, dropping seconds', () => {
    expect(formatRetryWait(60 * 60_000)).toBe('1h');
    expect(formatRetryWait(60 * 60_000 + 40 * 60_000)).toBe('1h 40m');
    expect(formatRetryWait(23 * 60 * 60_000 + 40 * 60_000 + 30_000)).toBe('23h 40m');
  });

  test('ceils rather than floors, so a countdown never shows 0s while still waiting', () => {
    expect(formatRetryWait(1)).toBe('1s');
    expect(formatRetryWait(999)).toBe('1s');
  });

  test('never renders a negative time', () => {
    expect(formatRetryWait(-5_000)).toBe('0s');
  });
});

describe('retryMessage', () => {
  test('embeds the formatted wait in a fixed sentence, used consistently everywhere', () => {
    expect(retryMessage(65_000)).toBe('AI usage limit reached. You can try again in 1m 5s.');
  });
});
