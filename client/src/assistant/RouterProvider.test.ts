import { describe, expect, it } from 'vitest';
import providerSource from './RouterProvider.tsx?raw';

// Structural guards over the provider's source text, not behavioural tests: the client test runner covers pure logic only,
// so the one stateful module has no behavioural coverage without React Testing Library. Manual verification (the throttled
// two-message test and the flags-off network trace) is the primary evidence. These catch deletion of a control, such as
// someone simplifying an await away, but not one that is present and wrong. Kept coarse (presence and ordering only) so
// ordinary refactors don't break them.

describe('the guards this file is watching', () => {
  it('can actually read the file it is guarding', () => {
    // A guard that silently matches nothing is worse than none.
    expect(providerSource).toContain('export function RouterProvider');
    expect(providerSource).toContain('const route = useCallback');
  });
});

describe('CHANGE-9 — the stale-response guard', () => {
  it('compares the response against the newest in-flight sequence', () => {
    expect(providerSource).toContain('sequence !== sequenceRef.current');
  });

  it('also consults the composer, which is the amendment\'s second half', () => {
    // Otherwise a teacher who gave up on a slow request and started typing gets navigated away mid-thought.
    expect(providerSource).toContain('!isComposerIdle()');
  });

  it('applies the guard BEFORE anything that could move the teacher', () => {
    const guard = providerSource.indexOf('sequence !== sequenceRef.current');
    const ask = providerSource.indexOf('setPendingAsk({ action');
    // Matches the call regardless of arity; the ordering is what's asserted.
    const navigate = providerSource.indexOf('return action ? dispatch(action, utterance');

    expect(guard).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(guard);
    expect(navigate).toBeGreaterThan(guard);
  });
});

describe('the flag is checked before any work happens', () => {
  it('short-circuits submit on the client flag', () => {
    // Makes "flags off ⇒ zero assistant requests" provable: nothing below the check can run.
    expect(providerSource).toContain('if (!ASSISTANT_ENABLED)');
  });

  it('checks the flag before the gate, the cache or the network', () => {
    const flag = providerSource.indexOf('if (!ASSISTANT_ENABLED)');
    const submitBody = providerSource.indexOf('const submit = useCallback');

    expect(flag).toBeGreaterThan(submitBody);
    expect(providerSource.indexOf('return route(utterance, null, isComposerIdle)')).toBeGreaterThan(flag);
  });
});

describe('the gate runs before the network, every time', () => {
  it('refuses a non-command before anything can be spent on it', () => {
    const gate = providerSource.indexOf('if (!isCommand(utterance)) return passthrough;');
    const breaker = providerSource.indexOf('breaker.isOpen()');
    const post = providerSource.indexOf('await postInterpret');

    expect(gate).toBeGreaterThan(-1);
    expect(breaker).toBeGreaterThan(gate);
    expect(post).toBeGreaterThan(breaker);
  });

  it('trips the breaker when the endpoint is unavailable', () => {
    expect(providerSource).toContain('breaker.trip()');
  });
});

describe('memory is written only on a settled turn', () => {
  it('merges updates after the ask branch has already returned', () => {
    // Client half of the server's rule: a guess mustn't outlive the question meant to resolve it.
    const askReturn = providerSource.indexOf("return { result: 'asked', utterance }");
    const merge = providerSource.indexOf('mergeMemory(response.memoryUpdates)');

    expect(askReturn).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(askReturn);
  });
});

describe('a repeat-cache hit replays its memory effect too (bug fix)', () => {
  // Regression guard: a cache hit used to dispatch straight away and skip memory. This checks the provider still merges
  // cached memory updates, and before dispatch (which may navigate away). Behaviour is covered in repeatCache.test.ts.
  it('reads the cached memoryUpdates before dispatching the cached decision', () => {
    const hit = providerSource.indexOf('const cached = readCached(key, catalogVersion)');
    const merge = providerSource.indexOf('mergeMemory(readCachedMemoryUpdates(key, catalogVersion))');
    const dispatch = providerSource.indexOf('return dispatch(cached, utterance)');

    expect(hit).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(hit);
    expect(dispatch).toBeGreaterThan(merge);
  });

  it('also carries memoryUpdates into the cache on write, for later hits to replay', () => {
    expect(providerSource).toContain('writeCached(key, response.catalogVersion, action, response.memoryUpdates)');
  });
});
