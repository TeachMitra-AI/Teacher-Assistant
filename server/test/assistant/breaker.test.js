// The router-yields-to-Coach breaker (M9, CHANGE-8).
//
// Pure module with an injected clock, so every window and cooldown boundary is
// asserted exactly rather than slept through.
//
// The four properties worth the file:
//   1. it opens at the threshold — and NOT one below it;
//   2. events expire, so a slow trickle of 429s across an hour never trips it;
//   3. it re-closes after the cooldown, and does so WITHOUT carrying the old
//      history forward (or the first 429 after recovery would re-open it);
//   4. a success does not reset the count — a storm failing half the time is
//      exactly the case worth reacting to.

const { createRouterBreaker, createDisabledBreaker } = require('../../src/assistant/breaker');

function fakeClock(startMs) {
  const state = { now: startMs };
  return {
    now: () => state.now,
    advance: (ms) => {
      state.now += ms;
    },
  };
}

const START = 1_000_000;

/** The defaults index.js ships, so the tests describe the real configuration. */
function makeBreaker(clock, overrides = {}) {
  return createRouterBreaker({
    threshold: 5,
    windowMs: 60_000,
    cooldownMs: 300_000,
    now: clock.now,
    ...overrides,
  });
}

describe('closed by default', () => {
  test('a fresh breaker is closed', () => {
    const breaker = makeBreaker(fakeClock(START));
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state().open).toBe(false);
  });

  test('successes alone never open it', () => {
    const breaker = makeBreaker(fakeClock(START));
    for (let i = 0; i < 100; i += 1) breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
  });
});

describe('opening', () => {
  test('opens at exactly the threshold', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 4; i += 1) breaker.recordRateLimited();
    // Four is not five. If this ever passes, the threshold is off by one and
    // the router yields earlier than configured.
    expect(breaker.isOpen()).toBe(false);

    breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(true);
  });

  test('does not open when the events straddle the window', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    // Four 429s, then a long gap, then one more. A trickle is not a storm.
    for (let i = 0; i < 4; i += 1) {
      breaker.recordRateLimited();
      clock.advance(20_000);
    }
    expect(breaker.isOpen()).toBe(false);

    clock.advance(120_000);
    breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(false);
  });

  test('opens when the events are inside the window', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) {
      breaker.recordRateLimited();
      clock.advance(1_000);
    }
    expect(breaker.isOpen()).toBe(true);
  });

  test('a success in the middle does not reset the count', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    breaker.recordRateLimited();
    breaker.recordRateLimited();
    breaker.recordSuccess();
    breaker.recordRateLimited();
    breaker.recordSuccess();
    breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordRateLimited();
    // Five 429s interleaved with successes still trips it: an upstream failing
    // half the time is precisely what the Coach needs protecting from.
    expect(breaker.isOpen()).toBe(true);
  });
});

describe('while open', () => {
  test('stays open for the whole cooldown', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(true);

    clock.advance(299_999);
    expect(breaker.isOpen()).toBe(true);
  });

  test('further 429s do not extend the cooldown', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    const opensAt = breaker.state().opensAt;

    clock.advance(60_000);
    for (let i = 0; i < 20; i += 1) breaker.recordRateLimited();
    expect(breaker.state().opensAt).toBe(opensAt);
  });
});

describe('closing', () => {
  test('closes once the cooldown elapses', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(true);

    clock.advance(300_000);
    expect(breaker.isOpen()).toBe(false);
  });

  test('does not re-open on the first 429 after recovery', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    clock.advance(300_001);
    expect(breaker.isOpen()).toBe(false);

    // If the pre-open history survived, this single event would put the count
    // back at the threshold and the router would yield permanently under mild
    // pressure.
    breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state().recent).toBe(1);
  });

  test('can open again after a genuine second storm', () => {
    const clock = fakeClock(START);
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    clock.advance(300_001);
    expect(breaker.isOpen()).toBe(false);

    for (let i = 0; i < 5; i += 1) breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(true);
  });
});

describe('the disabled breaker', () => {
  test('is never open, whatever it is told', () => {
    const breaker = createDisabledBreaker();
    for (let i = 0; i < 50; i += 1) breaker.recordRateLimited();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state()).toEqual({ open: false, recent: 0, opensAt: null });
  });
});

describe('isolation', () => {
  test('two breakers do not share state', () => {
    // The property that makes app.locals injection safe under
    // fileParallelism: false — one test opening a breaker must not affect another.
    const clock = fakeClock(START);
    const a = makeBreaker(clock);
    const b = makeBreaker(clock);

    for (let i = 0; i < 5; i += 1) a.recordRateLimited();
    expect(a.isOpen()).toBe(true);
    expect(b.isOpen()).toBe(false);
  });
});
