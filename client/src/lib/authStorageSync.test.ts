import { describe, expect, it } from 'vitest';
import { shouldResyncAuthOnStorageEvent } from './authStorageSync';

const TOKEN_KEY = 'auth_token';

describe('shouldResyncAuthOnStorageEvent', () => {
  it('resyncs when the access-token key itself changes (login, logout, or switched user)', () => {
    expect(shouldResyncAuthOnStorageEvent(TOKEN_KEY, TOKEN_KEY)).toBe(true);
  });

  it('resyncs when the key is null (localStorage.clear())', () => {
    expect(shouldResyncAuthOnStorageEvent(null, TOKEN_KEY)).toBe(true);
  });

  it('does not resync for the paired refresh-token key change from the same setSession() call', () => {
    expect(shouldResyncAuthOnStorageEvent('refresh_token', TOKEN_KEY)).toBe(false);
  });

  it('does not resync for unrelated app storage keys', () => {
    expect(shouldResyncAuthOnStorageEvent('theme', TOKEN_KEY)).toBe(false);
    expect(shouldResyncAuthOnStorageEvent('fontScale', TOKEN_KEY)).toBe(false);
  });

  it('does not resync for an empty-string key (distinct from null)', () => {
    expect(shouldResyncAuthOnStorageEvent('', TOKEN_KEY)).toBe(false);
  });

  it('is a pure function with no internal state — repeated calls with the same input are stable', () => {
    // Guards specifically against a future regression that adds hidden
    // mutable state to this decision (e.g. a counter or cache) which could
    // make its answer depend on call history instead of only its arguments
    // — exactly the kind of change that could turn a burst of rapid
    // storage events into runaway/inconsistent resync behavior.
    const results = Array.from({ length: 50 }, () => shouldResyncAuthOnStorageEvent(TOKEN_KEY, TOKEN_KEY));
    expect(results.every((r) => r === true)).toBe(true);

    const unrelatedResults = Array.from({ length: 50 }, () => shouldResyncAuthOnStorageEvent('theme', TOKEN_KEY));
    expect(unrelatedResults.every((r) => r === false)).toBe(true);
  });

  it('a rapid alternating sequence of events resolves independently per event, not cumulatively', () => {
    // Simulates two logins in quick succession in another tab (each
    // producing a token-key event followed by a refresh-token-key event).
    const sequence: Array<string | null> = [TOKEN_KEY, 'refresh_token', TOKEN_KEY, 'refresh_token'];
    const decisions = sequence.map((key) => shouldResyncAuthOnStorageEvent(key, TOKEN_KEY));
    expect(decisions).toEqual([true, false, true, false]);
  });
});
