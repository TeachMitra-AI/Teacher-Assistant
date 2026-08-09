import { describe, expect, it } from 'vitest';
import { resolveFeatureFlag } from './featureFlags';

describe('resolveFeatureFlag', () => {
  it('uses the live value when present, even when it disagrees with the fallback', () => {
    expect(resolveFeatureFlag(true, false)).toBe(true);
    expect(resolveFeatureFlag(false, true)).toBe(false);
  });

  it('falls back to the static default when the live value is undefined', () => {
    expect(resolveFeatureFlag(undefined, true)).toBe(true);
    expect(resolveFeatureFlag(undefined, false)).toBe(false);
  });
});
