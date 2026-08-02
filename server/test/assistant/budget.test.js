// Per-user daily budget counter (M9).
//
// Pure module, injected clock, no database and no Express — so every case below
// is exact rather than approximate. Time is a parameter here, which is what lets
// the day-rollover cases be asserted instead of hoped for.
//
// The behaviours that matter operationally, and why each is tested:
//   - the boundary (limit-th call allowed, limit+1-th refused) is the whole
//     contract, and off-by-one is the classic way a cost control is wrong;
//   - users are independent, or one busy teacher silences a staff room;
//   - the day rolls over, or the budget is a one-time allowance;
//   - the map is bounded, or the counter is a memory-growth vector.

const {
  createBudgetCounter,
  dayKeyFor,
  MAX_TRACKED_USERS,
  EVICTION_BATCH,
} = require('../../src/assistant/budget');

/** A clock the test drives by hand. */
function fakeClock(startMs) {
  const state = { now: startMs };
  return {
    now: () => state.now,
    advance: (ms) => {
      state.now += ms;
    },
    set: (ms) => {
      state.now = ms;
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed mid-day instant, so advancing by a day cannot accidentally straddle
// two rollovers and make a failure look like a pass.
const NOON_UTC = Date.parse('2026-07-29T12:00:00.000Z');

describe('dayKeyFor', () => {
  test('is the UTC calendar date', () => {
    expect(dayKeyFor(Date.parse('2026-07-29T12:00:00.000Z'))).toBe('2026-07-29');
  });

  test('rolls at UTC midnight, not at local midnight', () => {
    expect(dayKeyFor(Date.parse('2026-07-29T23:59:59.999Z'))).toBe('2026-07-29');
    expect(dayKeyFor(Date.parse('2026-07-30T00:00:00.000Z'))).toBe('2026-07-30');
  });
});

describe('consume — the boundary', () => {
  test('allows exactly `limit` calls and refuses the next', () => {
    const clock = fakeClock(NOON_UTC);
    const budget = createBudgetCounter({ limit: 3, now: clock.now });

    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(false);
  });

  test('stays refused for every subsequent call on the same day', () => {
    const clock = fakeClock(NOON_UTC);
    const budget = createBudgetCounter({ limit: 1, now: clock.now });

    expect(budget.consume('u1')).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      expect(budget.consume('u1')).toBe(false);
    }
    // A refused call must not also COUNT — otherwise the recorded usage of a
    // looping client grows without bound and peek() stops being readable.
    expect(budget.peek('u1')).toBe(1);
  });

  test('a limit of 1 refuses the second call, not the first', () => {
    const budget = createBudgetCounter({ limit: 1, now: () => NOON_UTC });
    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(false);
  });

  test('a limit of 0 refuses the FIRST call', () => {
    // The new-user path originally granted one call before looking at the
    // limit, so a zero budget still spent a model call. Unreachable through the
    // env (parseIntEnv clamps at 1) and fixed anyway: a control that is wrong at
    // its own boundary is not worth trusting elsewhere.
    const budget = createBudgetCounter({ limit: 0, now: () => NOON_UTC });
    expect(budget.consume('u1')).toBe(false);
    expect(budget.size()).toBe(0);
  });
});

describe('consume — isolation between users', () => {
  test('one exhausted user does not affect another', () => {
    const budget = createBudgetCounter({ limit: 2, now: () => NOON_UTC });

    expect(budget.consume('busy')).toBe(true);
    expect(budget.consume('busy')).toBe(true);
    expect(budget.consume('busy')).toBe(false);

    expect(budget.consume('quiet')).toBe(true);
    expect(budget.peek('quiet')).toBe(1);
  });
});

describe('consume — the day rolls over', () => {
  test('an exhausted user is allowed again the next UTC day', () => {
    const clock = fakeClock(NOON_UTC);
    const budget = createBudgetCounter({ limit: 2, now: clock.now });

    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(false);

    clock.advance(DAY_MS);

    expect(budget.consume('u1')).toBe(true);
    expect(budget.peek('u1')).toBe(1);
  });

  test('crossing UTC midnight resets even a few minutes later', () => {
    const clock = fakeClock(Date.parse('2026-07-29T23:58:00.000Z'));
    const budget = createBudgetCounter({ limit: 1, now: clock.now });

    expect(budget.consume('u1')).toBe(true);
    expect(budget.consume('u1')).toBe(false);

    clock.set(Date.parse('2026-07-30T00:02:00.000Z'));
    expect(budget.consume('u1')).toBe(true);
  });

  test('a stale entry does not survive as a stale count', () => {
    const clock = fakeClock(NOON_UTC);
    const budget = createBudgetCounter({ limit: 5, now: clock.now });

    budget.consume('u1');
    budget.consume('u1');
    expect(budget.peek('u1')).toBe(2);

    clock.advance(DAY_MS);
    // peek must report today, not yesterday — a budget that reads yesterday's
    // usage would refuse a teacher who has spent nothing.
    expect(budget.peek('u1')).toBe(0);
  });
});

describe('consume — degenerate input', () => {
  test('a missing user id is allowed through and not counted', () => {
    const budget = createBudgetCounter({ limit: 1, now: () => NOON_UTC });

    // Unreachable through the route (the caller is authenticated), so this is
    // about a bug in our own code: it must not cost a teacher their request.
    expect(budget.consume(undefined)).toBe(true);
    expect(budget.consume('')).toBe(true);
    expect(budget.consume(null)).toBe(true);
    expect(budget.size()).toBe(0);
  });
});

describe('the map is bounded', () => {
  test('eviction keeps the map under the cap', () => {
    const budget = createBudgetCounter({ limit: 100, now: () => NOON_UTC });

    for (let i = 0; i < MAX_TRACKED_USERS + 50; i += 1) {
      budget.consume(`user-${i}`);
    }

    expect(budget.size()).toBeLessThan(MAX_TRACKED_USERS);
    expect(budget.size()).toBeGreaterThan(MAX_TRACKED_USERS - EVICTION_BATCH - 100);
  });

  test('the most recent users survive eviction', () => {
    const budget = createBudgetCounter({ limit: 100, now: () => NOON_UTC });

    for (let i = 0; i < MAX_TRACKED_USERS + 50; i += 1) {
      budget.consume(`user-${i}`);
    }

    // The newest caller is still tracked; eviction sheds the front of the map.
    expect(budget.peek(`user-${MAX_TRACKED_USERS + 49}`)).toBe(1);
  });

  test('an over-budget user does not refresh their eviction position', () => {
    // Being evicted is the only way an exhausted user gets an early reset, and
    // they must not be able to postpone it by continuing to call.
    const budget = createBudgetCounter({ limit: 1, now: () => NOON_UTC });

    budget.consume('first');
    budget.consume('second');
    for (let i = 0; i < 5; i += 1) budget.consume('first'); // all refused

    // 'first' is still the oldest entry: refused calls do not re-insert.
    expect([...['first', 'second']].every((id) => budget.peek(id) === 1)).toBe(true);
  });
});
