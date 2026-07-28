import { describe, expect, it } from 'vitest';
import { BREAKER_OPEN_MS, createCircuitBreaker } from './circuitBreaker';

// The breaker's only job is to stop the teacher waiting on an endpoint that is
// not answering. The clock is injected so the sixty-second window is asserted
// rather than waited for.

function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createCircuitBreaker', () => {
  it('starts closed', () => {
    const clock = fakeClock();
    expect(createCircuitBreaker(BREAKER_OPEN_MS, clock.now).isOpen()).toBe(false);
  });

  it('opens on a transport failure and stays open for the full window', () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker(BREAKER_OPEN_MS, clock.now);

    breaker.trip();
    expect(breaker.isOpen()).toBe(true);

    clock.advance(BREAKER_OPEN_MS - 1);
    expect(breaker.isOpen()).toBe(true);
  });

  it('closes once the window has elapsed', () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker(BREAKER_OPEN_MS, clock.now);

    breaker.trip();
    clock.advance(BREAKER_OPEN_MS);
    expect(breaker.isOpen()).toBe(false);
  });

  it('extends the window from the latest failure, not the first', () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker(BREAKER_OPEN_MS, clock.now);

    breaker.trip();
    clock.advance(BREAKER_OPEN_MS - 1000);
    breaker.trip();

    // The original window has now passed, but the second failure was recent.
    clock.advance(1000);
    expect(breaker.isOpen()).toBe(true);
  });

  it('closes immediately on reset', () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker(BREAKER_OPEN_MS, clock.now);

    breaker.trip();
    breaker.reset();
    expect(breaker.isOpen()).toBe(false);
  });

  it('uses the sixty-second window the spec gives the client on a 429', () => {
    expect(BREAKER_OPEN_MS).toBe(60 * 1000);
  });

  it('defaults to the real clock without a caller having to supply one', () => {
    const breaker = createCircuitBreaker();
    expect(breaker.isOpen()).toBe(false);
    breaker.trip();
    expect(breaker.isOpen()).toBe(true);
  });
});
