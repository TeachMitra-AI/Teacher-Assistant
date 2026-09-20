// Billing (Phase 1) — the master switch.
//
// The property that matters: billing is OFF unless someone deliberately turns
// it on. A deployment that sets nothing must behave exactly as it did before
// billing existed. A typo must warn and keep the safe default, never crash and
// never silently turn the feature on.

const { readBillingFlags, BILLING_FLAG_DEFAULTS } = require('../../src/lib/flags');

function withWarn() {
  const warnings = [];
  return { warn: (m) => warnings.push(m), warnings };
}

describe('flags.readBillingFlags', () => {
  test('an empty environment leaves billing OFF, with no warning', () => {
    const { warn, warnings } = withWarn();
    expect(readBillingFlags({}, { warn })).toEqual({ enabled: false });
    expect(warnings).toHaveLength(0);
  });

  test('the documented default matches what is actually returned', () => {
    expect(readBillingFlags({})).toEqual({ enabled: BILLING_FLAG_DEFAULTS.enabled });
    expect(BILLING_FLAG_DEFAULTS.enabled).toBe(false);
  });

  test.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])('%j turns billing on', (value) => {
    expect(readBillingFlags({ BILLING_ENABLED: value }).enabled).toBe(true);
  });

  test.each(['false', '0', 'no', 'off', ''])('%j leaves billing off', (value) => {
    expect(readBillingFlags({ BILLING_ENABLED: value }).enabled).toBe(false);
  });

  test('a typo warns and keeps billing OFF', () => {
    const { warn, warnings } = withWarn();
    expect(readBillingFlags({ BILLING_ENABLED: 'ture' }, { warn }).enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BILLING_ENABLED');
  });

  test('the defaults object is frozen', () => {
    expect(Object.isFrozen(BILLING_FLAG_DEFAULTS)).toBe(true);
  });
});
