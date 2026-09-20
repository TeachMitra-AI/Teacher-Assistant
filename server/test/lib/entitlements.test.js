// Billing (Phase 1) — the entitlement resolver.
//
// resolveEntitlements is pure: role, subscription rows, the current time and
// the settings all come in as arguments, so every case below uses a fixed date
// and never waits for one. getUserEntitlements and getBillingSummaryForMe are
// checked against a fake database object, so nothing here needs a real one.

const {
  STATES,
  addMonths,
  resolveEntitlements,
  getUserEntitlements,
  toBillingSummary,
  getBillingSummaryForMe,
} = require('../../src/lib/entitlements');
const { readBillingConfig } = require('../../src/lib/plans');

const DAY = 24 * 60 * 60 * 1000;
const config = readBillingConfig({}); // grace 3 days, only super_admin exempt

const END = new Date('2026-10-20T12:00:00.000Z');
const GRACE_END = new Date(END.getTime() + 3 * DAY);

function pro(overrides = {}) {
  return { status: 'active', planKey: 'teacher_pro', endsAt: END, ...overrides };
}

function resolve({ role = 'teacher', subscriptions = [], now, cfg = config }) {
  return resolveEntitlements({ role, subscriptions, now, config: cfg });
}

describe('entitlements.resolveEntitlements', () => {
  test('no subscription row: Basic, with the free limits', () => {
    const e = resolve({ now: new Date('2026-10-01T00:00:00Z') });
    expect(e.state).toBe(STATES.BASIC);
    expect(e.planKey).toBe('teacher_basic');
    expect(e.endsAt).toBeNull();
    expect(e.graceEndsAt).toBeNull();
    expect(e.limits).toEqual({ classes: 2, questionsPerMonth: 50, imagesPerMonth: 10, pdfsPerMonth: 5 });
    expect(e.features).toEqual({ reportDownloads: false, classroomMode: false, lessonPlans: false });
  });

  test('a running Pro row: active, everything unlimited', () => {
    const e = resolve({ subscriptions: [pro()], now: new Date('2026-10-01T00:00:00Z') });
    expect(e.state).toBe(STATES.ACTIVE);
    expect(e.planKey).toBe('teacher_pro');
    expect(e.endsAt).toEqual(END);
    expect(e.graceEndsAt).toEqual(GRACE_END);
    expect(e.limits).toEqual({ classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null });
    expect(e.features).toEqual({ reportDownloads: true, classroomMode: true, lessonPlans: true });
  });

  describe('the exact boundaries', () => {
    test.each([
      ['one millisecond before the end', new Date(END.getTime() - 1), STATES.ACTIVE],
      ['exactly at the end (grace starts)', END, STATES.GRACE],
      ['one millisecond before grace ends', new Date(GRACE_END.getTime() - 1), STATES.GRACE],
      ['exactly when grace ends (back to Basic)', GRACE_END, STATES.BASIC],
      ['long after', new Date('2027-01-01T00:00:00Z'), STATES.BASIC],
    ])('%s', (_label, now, expectedState) => {
      expect(resolve({ subscriptions: [pro()], now }).state).toBe(expectedState);
    });
  });

  test('in grace the user still has Pro features and keeps the dates', () => {
    const e = resolve({ subscriptions: [pro()], now: new Date(END.getTime() + DAY) });
    expect(e.state).toBe(STATES.GRACE);
    expect(e.features.classroomMode).toBe(true);
    expect(e.limits.questionsPerMonth).toBeNull();
    expect(e.endsAt).toEqual(END);
  });

  test('after grace the dates are cleared and the free limits return', () => {
    const e = resolve({ subscriptions: [pro()], now: new Date(GRACE_END.getTime() + DAY) });
    expect(e.state).toBe(STATES.BASIC);
    expect(e.endsAt).toBeNull();
    expect(e.limits.classes).toBe(2);
  });

  test('zero grace days: Pro ends exactly at the end date', () => {
    const cfg = readBillingConfig({ BILLING_GRACE_DAYS: '0' });
    expect(resolve({ subscriptions: [pro()], now: new Date(END.getTime() - 1), cfg }).state).toBe(STATES.ACTIVE);
    expect(resolve({ subscriptions: [pro()], now: END, cfg }).state).toBe(STATES.BASIC);
  });

  test('a longer grace period is honoured', () => {
    const cfg = readBillingConfig({ BILLING_GRACE_DAYS: '10' });
    const now = new Date(END.getTime() + 9 * DAY);
    expect(resolve({ subscriptions: [pro()], now, cfg }).state).toBe(STATES.GRACE);
  });

  describe('rows that must not count', () => {
    const now = new Date('2026-10-01T00:00:00Z');

    test('a revoked row is ignored', () => {
      expect(resolve({ subscriptions: [pro({ status: 'revoked' })], now }).state).toBe(STATES.BASIC);
    });

    test('a row for any plan other than Pro is ignored', () => {
      expect(resolve({ subscriptions: [pro({ planKey: 'teacher_basic' })], now }).state).toBe(STATES.BASIC);
      expect(resolve({ subscriptions: [pro({ planKey: 'platinum' })], now }).state).toBe(STATES.BASIC);
    });

    test('an unknown status is ignored', () => {
      expect(resolve({ subscriptions: [pro({ status: 'pending' })], now }).state).toBe(STATES.BASIC);
    });
  });

  test('several rows: the one that ends last decides, in any order', () => {
    const older = pro({ endsAt: new Date('2026-08-01T00:00:00Z') });
    const newer = pro({ endsAt: END });
    const now = new Date('2026-10-01T00:00:00Z');
    expect(resolve({ subscriptions: [older, newer], now }).endsAt).toEqual(END);
    expect(resolve({ subscriptions: [newer, older], now }).endsAt).toEqual(END);
  });

  test('an old ended row plus a running one: the running one wins', () => {
    const ended = pro({ endsAt: new Date('2026-01-01T00:00:00Z') });
    const e = resolve({ subscriptions: [ended, pro()], now: new Date('2026-10-01T00:00:00Z') });
    expect(e.state).toBe(STATES.ACTIVE);
  });

  describe('exempt roles', () => {
    test('super_admin is exempt: unlimited, with no dates, whatever the rows say', () => {
      const e = resolve({ role: 'super_admin', subscriptions: [], now: new Date('2026-10-01T00:00:00Z') });
      expect(e.state).toBe(STATES.EXEMPT);
      expect(e.endsAt).toBeNull();
      expect(e.limits).toEqual({ classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null });
      expect(e.features.classroomMode).toBe(true);
    });

    test('school_admin and resource_person are ordinary teachers by default', () => {
      const now = new Date('2026-10-01T00:00:00Z');
      expect(resolve({ role: 'school_admin', now }).state).toBe(STATES.BASIC);
      expect(resolve({ role: 'resource_person', now }).state).toBe(STATES.BASIC);
    });

    test('the exempt list is a setting', () => {
      const cfg = readBillingConfig({ BILLING_EXEMPT_ROLES: 'super_admin,school_admin' });
      expect(resolve({ role: 'school_admin', now: new Date(), cfg }).state).toBe(STATES.EXEMPT);
    });
  });

  test('the inputs are never modified', () => {
    const rows = [pro({ endsAt: new Date('2026-08-01T00:00:00Z') }), pro()];
    const snapshot = rows.map((r) => ({ ...r }));
    resolve({ subscriptions: rows, now: new Date('2026-10-01T00:00:00Z') });
    expect(rows).toEqual(snapshot);
  });
});

describe('entitlements.addMonths', () => {
  const iso = (d) => d.toISOString();

  test.each([
    ['a plain month', '2026-09-20T10:30:00.000Z', 1, '2026-10-20T10:30:00.000Z'],
    ['31 Jan + 1 month is the last day of February (common year)', '2027-01-31T08:00:00.000Z', 1, '2027-02-28T08:00:00.000Z'],
    ['31 Jan + 1 month is 29 Feb in a leap year', '2028-01-31T08:00:00.000Z', 1, '2028-02-29T08:00:00.000Z'],
    ['31 Mar + 1 month is 30 April', '2026-03-31T00:00:00.000Z', 1, '2026-04-30T00:00:00.000Z'],
    ['December rolls into the next year', '2026-12-15T00:00:00.000Z', 1, '2027-01-15T00:00:00.000Z'],
    ['twelve months is a year', '2026-09-20T00:00:00.000Z', 12, '2027-09-20T00:00:00.000Z'],
    ['29 Feb + 12 months is 28 Feb', '2028-02-29T00:00:00.000Z', 12, '2029-02-28T00:00:00.000Z'],
    ['36 months', '2026-09-20T00:00:00.000Z', 36, '2029-09-20T00:00:00.000Z'],
  ])('%s', (_label, start, months, expected) => {
    expect(iso(addMonths(new Date(start), months))).toBe(expected);
  });

  test('does not modify the date passed in', () => {
    const start = new Date('2026-09-20T00:00:00.000Z');
    addMonths(start, 3);
    expect(start.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
});

describe('entitlements.toBillingSummary', () => {
  test('turns dates into ISO strings and keeps null for unlimited', () => {
    const e = resolve({ subscriptions: [pro()], now: new Date('2026-10-01T00:00:00Z') });
    expect(toBillingSummary(e)).toEqual({
      plan: 'teacher_pro',
      state: 'active',
      endsAt: '2026-10-20T12:00:00.000Z',
      graceEndsAt: '2026-10-23T12:00:00.000Z',
      features: { reportDownloads: true, classroomMode: true, lessonPlans: true },
      limits: { classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null },
    });
  });

  test('Basic has null dates and the free limits', () => {
    const e = resolve({ now: new Date('2026-10-01T00:00:00Z') });
    expect(toBillingSummary(e)).toEqual({
      plan: 'teacher_basic',
      state: 'basic',
      endsAt: null,
      graceEndsAt: null,
      features: { reportDownloads: false, classroomMode: false, lessonPlans: false },
      limits: { classes: 2, questionsPerMonth: 50, imagesPerMonth: 10, pdfsPerMonth: 5 },
    });
  });
});

describe('entitlements.getUserEntitlements (fake database)', () => {
  function fakeDb(rows) {
    return { subscription: { findMany: vi.fn(async () => rows) } };
  }

  test('asks only for this user\'s active rows, newest end first, one row', async () => {
    const db = fakeDb([pro()]);
    const e = await getUserEntitlements(db, { id: 'u1', role: 'teacher' }, { now: new Date('2026-10-01T00:00:00Z'), env: {} });
    expect(e.state).toBe(STATES.ACTIVE);
    expect(db.subscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.subscription.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'active' },
      orderBy: { endsAt: 'desc' },
      take: 1,
    });
  });

  test('an exempt role never reads the database', async () => {
    const db = fakeDb([]);
    const e = await getUserEntitlements(db, { id: 'u2', role: 'super_admin' }, { env: {} });
    expect(e.state).toBe(STATES.EXEMPT);
    expect(db.subscription.findMany).not.toHaveBeenCalled();
  });

  test('reads its settings from the environment it is given', async () => {
    const db = fakeDb([]);
    const e = await getUserEntitlements(db, { id: 'u3', role: 'teacher' }, { env: { BILLING_BASIC_MAX_CLASSES: '7' } });
    expect(e.limits.classes).toBe(7);
  });
});

describe('entitlements.getBillingSummaryForMe (the GET /me helper)', () => {
  const user = { id: 'u1', role: 'teacher' };
  const now = new Date('2026-10-01T00:00:00Z');

  test('billing OFF: returns null and never touches the database', async () => {
    const db = { subscription: { findMany: vi.fn() } };
    expect(await getBillingSummaryForMe(db, user, { now, env: {} })).toBeNull();
    expect(await getBillingSummaryForMe(db, user, { now, env: { BILLING_ENABLED: 'false' } })).toBeNull();
    expect(db.subscription.findMany).not.toHaveBeenCalled();
  });

  test('billing ON: returns the summary', async () => {
    const db = { subscription: { findMany: vi.fn(async () => [pro()]) } };
    const summary = await getBillingSummaryForMe(db, user, { now, env: { BILLING_ENABLED: 'true' } });
    expect(summary.plan).toBe('teacher_pro');
    expect(summary.state).toBe('active');
  });

  test('a database error is swallowed: returns null and logs, never throws', async () => {
    const db = { subscription: { findMany: vi.fn(async () => { throw new Error('db is gone'); }) } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(getBillingSummaryForMe(db, user, { now, env: { BILLING_ENABLED: 'true' } })).resolves.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('[billing]');
    } finally {
      spy.mockRestore();
    }
  });
});
