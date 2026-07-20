const { parseIntEnv } = require('../../src/lib/config');

const BOUNDS = { name: 'TEST_VAR', defaultValue: 8, min: 1, max: 20 };

function withWarn() {
  const warnings = [];
  return { warn: (m) => warnings.push(m), warnings };
}

describe('config.parseIntEnv', () => {
  test('missing or empty returns the default, with no warning', () => {
    const { warn, warnings } = withWarn();
    expect(parseIntEnv(undefined, { ...BOUNDS, warn })).toBe(8);
    expect(parseIntEnv('', { ...BOUNDS, warn })).toBe(8);
    expect(parseIntEnv('   ', { ...BOUNDS, warn })).toBe(8);
    expect(warnings).toHaveLength(0);
  });

  test('a valid in-range integer is returned as-is', () => {
    const { warn, warnings } = withWarn();
    expect(parseIntEnv('5', { ...BOUNDS, warn })).toBe(5);
    expect(warnings).toHaveLength(0);
  });

  test('a non-integer string falls back to the default and warns', () => {
    const { warn, warnings } = withWarn();
    expect(parseIntEnv('abc', { ...BOUNDS, warn })).toBe(8);
    expect(parseIntEnv('3.5', { ...BOUNDS, warn })).toBe(8);
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toMatch(/TEST_VAR/);
  });

  test('a value below the minimum clamps to the minimum and warns', () => {
    const { warn, warnings } = withWarn();
    expect(parseIntEnv('0', { ...BOUNDS, warn })).toBe(1);
    expect(parseIntEnv('-4', { ...BOUNDS, warn })).toBe(1);
    expect(warnings.length).toBe(2);
  });

  test('a value above the maximum clamps to the maximum and warns', () => {
    const { warn, warnings } = withWarn();
    expect(parseIntEnv('999', { ...BOUNDS, warn })).toBe(20);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/maximum/);
  });
});
