import { beforeEach, describe, expect, it, vi } from 'vitest';
// The executor's own source, as text. Vite's ?raw import rather than node:fs:
// it needs no @types/node, works identically under jsdom, and is already typed
// by the vite/client reference in src/vite-env.d.ts.
import executorSource from './ActionExecutor.ts?raw';
import { executeAction } from './ActionExecutor';
import { REGISTERED_ACTION_IDS, REGISTERED_DOMAINS } from './handlers';
import { DRAFT_STORAGE_KEY } from './draftStore';
import type { ActionDecision, ActionEffect, ResolvedAction } from './types';

// The executor is the last thing standing between a server response and a
// navigation, so almost everything here is a test of what it REFUSES to do.
//
// The single most important assertion in this file is the `execute` downgrade:
// it is the client-side half of "nothing generates without a human click", and
// it is the one guard a future server rollout could otherwise walk straight
// past.

function action(overrides: Partial<ResolvedAction> = {}): ResolvedAction {
  return {
    actionId: 'generate_assessment',
    version: 1,
    effect: 'draft',
    decision: 'prefill',
    confidence: 'high',
    params: { format: 'worksheet', topic: 'Fractions' },
    provenance: { format: 'utterance', topic: 'utterance' },
    missing: [],
    lowConfidenceFields: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('dispatch', () => {
  it('runs the registered handler and reports a navigation', () => {
    const navigate = vi.fn();
    expect(executeAction(action(), { navigate, utterance: 'make a worksheet' })).toBe('navigated');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatch(/^\/generator\?ai=/);
  });

  it('runs a handler that writes no draft', () => {
    const navigate = vi.fn();
    const outcome = executeAction(
      action({ actionId: 'open_generator', effect: 'read', params: {}, provenance: {} }),
      { navigate, utterance: 'open the generator' }
    );
    expect(outcome).toBe('navigated');
    expect(navigate).toHaveBeenCalledWith('/generator');
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});

describe('decision handling', () => {
  it('DOWNGRADES execute to prefill instead of acting on it', () => {
    // Phase 1 never emits this. Handling it defensively is what stops a future
    // server rollout surprising a service-worker-cached client into generating
    // without teacher review.
    const navigate = vi.fn();
    const outcome = executeAction(action({ decision: 'execute' }), {
      navigate,
      utterance: 'make a worksheet',
    });

    expect(outcome).toBe('navigated');
    expect(navigate.mock.calls[0][0]).toMatch(/^\/generator\?ai=/);
    expect(console.warn).toHaveBeenCalledWith(
      '[assistant] execute_downgraded_to_prefill',
      expect.objectContaining({ actionId: 'generate_assessment' })
    );
  });

  it.each<ActionDecision>(['ask', 'suggest', 'passthrough'])(
    'refuses to act on decision %s',
    (decision) => {
      const navigate = vi.fn();
      expect(executeAction(action({ decision }), { navigate, utterance: 'x' })).toBe('passthrough');
      expect(navigate).not.toHaveBeenCalled();
    }
  );

  it('refuses a decision it has never heard of', () => {
    const navigate = vi.fn();
    const outcome = executeAction(action({ decision: 'auto_send' as ActionDecision }), {
      navigate,
      utterance: 'x',
    });
    expect(outcome).toBe('passthrough');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the effect ceiling', () => {
  it.each<ActionEffect>(['write', 'destructive'])('refuses effect %s at any decision', (effect) => {
    // Registry-declared and already capped server-side; asserted independently
    // here so the ceiling still holds against a misconfigured future server.
    const navigate = vi.fn();
    expect(executeAction(action({ effect }), { navigate, utterance: 'x' })).toBe('passthrough');
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each<ActionEffect>(['read', 'draft'])('acts on effect %s', (effect) => {
    const navigate = vi.fn();
    expect(executeAction(action({ effect }), { navigate, utterance: 'x' })).toBe('navigated');
  });

  it('refuses an absent effect rather than assuming one', () => {
    const navigate = vi.fn();
    const outcome = executeAction(action({ effect: undefined as unknown as ActionEffect }), {
      navigate,
      utterance: 'x',
    });
    expect(outcome).toBe('passthrough');
  });
});

describe('unknown action ids — the routine stale-client case', () => {
  it('falls back to the module home when the catalog knows the domain', () => {
    const navigate = vi.fn();
    const outcome = executeAction(action({ actionId: 'duplicate_assessment' }), {
      navigate,
      utterance: 'x',
      domainOf: () => 'generator',
    });

    expect(outcome).toBe('navigated');
    expect(navigate).toHaveBeenCalledWith('/generator');
  });

  it('passes through when the domain is unknown too', () => {
    const navigate = vi.fn();
    const outcome = executeAction(action({ actionId: 'mark_attendance' }), {
      navigate,
      utterance: 'x',
      domainOf: () => 'attendance',
    });

    expect(outcome).toBe('passthrough');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes through when no catalog is available to ask', () => {
    const navigate = vi.fn();
    expect(
      executeAction(action({ actionId: 'duplicate_assessment' }), { navigate, utterance: 'x' })
    ).toBe('passthrough');
  });

  it('NEVER throws — a throw here is a blank screen', () => {
    const navigate = vi.fn();
    expect(() =>
      executeAction(action({ actionId: 'something_from_2027' }), { navigate, utterance: 'x' })
    ).not.toThrow();
  });

  it('does not resolve inherited Object properties as handlers', () => {
    const navigate = vi.fn();
    for (const actionId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(executeAction(action({ actionId }), { navigate, utterance: 'x' })).toBe('passthrough');
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('malformed input', () => {
  it.each([null, undefined, 'a string', 42, [], {}, { actionId: '' }])(
    'passes through on %j without throwing',
    (malformed) => {
      const navigate = vi.fn();
      expect(executeAction(malformed as unknown as ResolvedAction, { navigate, utterance: 'x' })).toBe(
        'passthrough'
      );
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});

describe('a broken handler must not break the composer', () => {
  it('catches a throwing handler and passes through', () => {
    const navigate = vi.fn(() => {
      throw new Error('router exploded');
    });
    expect(executeAction(action(), { navigate, utterance: 'make a worksheet' })).toBe('passthrough');
    expect(console.warn).toHaveBeenCalledWith(
      '[assistant] execute_handler_failed',
      expect.objectContaining({ actionId: 'generate_assessment' })
    );
  });

  it('logs nothing that could carry a parameter value', () => {
    const navigate = vi.fn(() => {
      throw new Error('failed on topic "Fractions"');
    });
    executeAction(action(), { navigate, utterance: 'make a fractions worksheet' });

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).not.toContain('Fractions');
    expect(logged).not.toContain('fractions');
    expect(logged).not.toContain('worksheet');
  });
});

describe('the registry-driven invariant', () => {
  // Adding an action must require one new handler and one registration line, and
  // ZERO edits to ActionExecutor.ts. These two assertions are the control that
  // makes that claim checkable in review rather than merely stated in a comment.
  const source = executorSource;

  it('can actually read the file it is guarding', () => {
    // A text guard that silently matches nothing is worse than no guard at all.
    expect(source).toContain('export function executeAction');
  });

  it.each(REGISTERED_ACTION_IDS)('contains no branch on the action id %s', (actionId) => {
    expect(source).not.toContain(actionId);
  });

  it.each(REGISTERED_DOMAINS)('contains no branch on the domain %s', (domain) => {
    expect(source).not.toContain(`'${domain}'`);
  });

  it('contains no route string — those live only in handlers/', () => {
    // Guardrail G16. The executor navigates only to a path a lookup handed it.
    expect(source).not.toMatch(/['"`]\/[a-z]/);
  });

  it('dispatches through the map, so a new action needs no change here', () => {
    // Both registered actions run through the identical code path above; the
    // only thing that distinguishes them is which handler the lookup returned.
    expect(REGISTERED_ACTION_IDS).toContain('generate_assessment');
    expect(REGISTERED_ACTION_IDS).toContain('open_generator');
  });
});
