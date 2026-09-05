import { describe, expect, test } from 'vitest';
import { fallbackErrorMessage } from './apiErrorMessages';

describe('fallbackErrorMessage', () => {
  test('429 gets a friendly rate-limit message, not the raw status', () => {
    expect(fallbackErrorMessage(429)).toBe('Too many requests. Please wait a moment and try again.');
  });

  test('502/503/504 all get the same friendly "temporarily unavailable" message', () => {
    const expected = 'The service is temporarily unavailable. Please try again in a moment.';
    expect(fallbackErrorMessage(502)).toBe(expected);
    expect(fallbackErrorMessage(503)).toBe(expected);
    expect(fallbackErrorMessage(504)).toBe(expected);
  });

  test('500 gets a friendly generic message', () => {
    expect(fallbackErrorMessage(500)).toBe('Something went wrong on our end. Please try again.');
  });

  test('an unmapped status falls back to the raw "Request failed (N)." text, unchanged', () => {
    expect(fallbackErrorMessage(418)).toBe('Request failed (418).');
    expect(fallbackErrorMessage(400)).toBe('Request failed (400).');
  });

  test('none of the friendly messages leak the numeric status code', () => {
    expect(fallbackErrorMessage(429)).not.toMatch(/\d/);
    expect(fallbackErrorMessage(500)).not.toMatch(/\d/);
    expect(fallbackErrorMessage(503)).not.toMatch(/\d/);
  });
});
