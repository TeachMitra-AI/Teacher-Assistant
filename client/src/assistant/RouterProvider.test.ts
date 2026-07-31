import { describe, expect, it } from 'vitest';
import providerSource from './RouterProvider.tsx?raw';

// ─── READ THIS BEFORE TRUSTING THIS FILE ───────────────────────────────────
// These are STRUCTURAL guards over the provider's source text, not behavioural
// tests. They exist because the client test runner covers pure logic only (spec
// §10.3, a deliberate decision), so the one stateful module in the router has no
// behavioural coverage available to it without introducing React Testing
// Library — which is a separate initiative, not an M6 task.
//
// What that means in practice, stated plainly rather than papered over:
//
//   - PRIMARY evidence for the behaviours below is the manual verification
//     script (§21's M6 gate), specifically the throttled two-message test for
//     CHANGE-9 and the flags-off network trace.
//   - These guards catch DELETION of a control, which is the realistic
//     regression — someone simplifying an await away, or "cleaning up" a
//     condition whose purpose is not obvious from the line itself. They cannot
//     catch a control that is present but wrong.
//
// They are kept deliberately coarse: presence and ordering only, no assertions
// about formatting, so an ordinary refactor does not break them. A guard that
// cries wolf teaches reviewers to skip it (the M2 lesson about controls).

describe('the guards this file is watching', () => {
  it('can actually read the file it is guarding', () => {
    // A source guard that silently matches nothing is worse than no guard.
    expect(providerSource).toContain('export function RouterProvider');
    expect(providerSource).toContain('const route = useCallback');
  });
});

describe('CHANGE-9 — the stale-response guard', () => {
  it('compares the response against the newest in-flight sequence', () => {
    expect(providerSource).toContain('sequence !== sequenceRef.current');
  });

  it('also consults the composer, which is the amendment\'s second half', () => {
    // Without this, a teacher who gave up on a slow request and started typing a
    // coaching question gets navigated away mid-thought.
    expect(providerSource).toContain('!isComposerIdle()');
  });

  it('applies the guard BEFORE anything that could move the teacher', () => {
    const guard = providerSource.indexOf('sequence !== sequenceRef.current');
    const ask = providerSource.indexOf('setPendingAsk({ action');
    // Matches the call regardless of arity: M8 added a third argument (the
    // telemetry correlation id). The ORDERING below is the assertion; the
    // argument list was never meant to be part of it, and this file's own header
    // says these guards are "presence and ordering only, no assertions about
    // formatting, so an ordinary refactor does not break them".
    const navigate = providerSource.indexOf('return action ? dispatch(action, utterance');

    expect(guard).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(guard);
    expect(navigate).toBeGreaterThan(guard);
  });
});

describe('the flag is checked before any work happens', () => {
  it('short-circuits submit on the client flag', () => {
    // This is what makes "flags off ⇒ zero assistant requests" provable rather
    // than asserted: nothing below the check can run.
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
    // interpret.js refuses to emit memoryUpdates on an ask; this is the client
    // half of the same rule — a guess must not outlive the question meant to
    // resolve it.
    const askReturn = providerSource.indexOf("return { result: 'asked', utterance }");
    const merge = providerSource.indexOf('mergeMemory(response.memoryUpdates)');

    expect(askReturn).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(askReturn);
  });
});

describe('a repeat-cache hit replays its memory effect too (bug fix)', () => {
  // Regression guard: a cache hit used to `return dispatch(cached, utterance)`
  // straight away, which skipped memory entirely for any utterance the router
  // had already decided once — including one this very turn recovered a slot
  // from. See repeatCache.test.ts for the behavioural coverage of the storage
  // side; this only guards that the provider still calls it, and before
  // dispatch, since dispatch may navigate away.
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
