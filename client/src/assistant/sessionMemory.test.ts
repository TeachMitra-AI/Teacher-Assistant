import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_FIRST_TURN,
  MEMORY_MAX_SLOTS,
  MEMORY_STORAGE_KEY,
  advanceTurn,
  clearMemory,
  currentTurn,
  mergeMemory,
  readMemory,
} from './sessionMemory';
import type { SessionMemory } from './types';

// Two properties matter here and they pull in opposite directions.
//
// FAIL-SOFT: every path degrades to "no memory", because sessionStorage is
// unavailable in private browsing on the target devices and losing memory must
// cost prefill quality rather than a working composer.
//
// NO TTL: this store deliberately does not expire anything (approved decision
// D1). resolver.js re-applies expiry to whatever the client sends, explicitly so
// the pipeline does not depend on the client having done it — so a second
// implementation here would be a fourth home for one rule. The test that proves
// this is `keeps a slot the server would consider expired`.

const slot = (value: string, turn: number): SessionMemory[string] => ({
  value,
  source: 'utterance',
  turn,
});

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('readMemory / mergeMemory', () => {
  it('starts empty', () => {
    expect(readMemory()).toEqual({});
  });

  it('round-trips slots', () => {
    mergeMemory({ grade: slot('Class 3-5', 2), subject: slot('Mathematics', 2) });
    expect(readMemory()).toEqual({
      grade: { value: 'Class 3-5', source: 'utterance', turn: 2 },
      subject: { value: 'Mathematics', source: 'utterance', turn: 2 },
    });
  });

  it('replaces a slot wholesale rather than merging its fields', () => {
    mergeMemory({ topic: { value: 'Fractions', raw: 'fractions', source: 'utterance', turn: 1 } });
    mergeMemory({ topic: { value: 'Decimals', source: 'memory', turn: 4 } });
    // `raw` from the first write must not survive onto the second value: pairing
    // one turn's canonical value with another's phrasing is how provenance lies.
    expect(readMemory().topic).toEqual({ value: 'Decimals', source: 'memory', turn: 4 });
  });

  it('keeps a numeric value, which the contract allows', () => {
    mergeMemory({ questionCount: { value: 10, source: 'default', turn: 1 } });
    expect(readMemory().questionCount.value).toBe(10);
  });

  it('preserves the display-only raw phrase when present', () => {
    mergeMemory({ grade: { value: 'Class 3-5', raw: 'class 5', source: 'utterance', turn: 1 } });
    expect(readMemory().grade.raw).toBe('class 5');
  });

  it('ignores undefined updates, which is what an ask response carries', () => {
    mergeMemory({ grade: slot('Class 3-5', 1) });
    mergeMemory(undefined);
    expect(readMemory().grade).toBeDefined();
  });

  it('drops a malformed slot without discarding the good ones', () => {
    mergeMemory({
      grade: slot('Class 3-5', 1),
      broken: { value: null, source: 'utterance', turn: 1 } as unknown as SessionMemory[string],
      alsoBroken: { value: 'x', source: 'utterance' } as unknown as SessionMemory[string],
    });
    const memory = readMemory();
    expect(memory.grade).toBeDefined();
    expect(memory.broken).toBeUndefined();
    expect(memory.alsoBroken).toBeUndefined();
  });

  it('keeps a slot the server would consider expired', () => {
    // topic has a 2-turn TTL server-side. Sending it on turn 99 is correct
    // behaviour for this module: the resolver drops it, and the client holds no
    // second copy of the rule.
    mergeMemory({ topic: slot('Fractions', 1) });
    for (let i = 0; i < 98; i += 1) advanceTurn();
    expect(readMemory().topic).toEqual({ value: 'Fractions', source: 'utterance', turn: 1 });
  });
});

describe('turn counter', () => {
  it('starts at the first turn the envelope accepts', () => {
    expect(currentTurn()).toBe(MEMORY_FIRST_TURN);
  });

  it('advances monotonically and persists', () => {
    expect(advanceTurn()).toBe(MEMORY_FIRST_TURN + 1);
    expect(advanceTurn()).toBe(MEMORY_FIRST_TURN + 2);
    expect(currentTurn()).toBe(MEMORY_FIRST_TURN + 2);
  });

  it('survives alongside slot writes', () => {
    advanceTurn();
    mergeMemory({ grade: slot('Class 3-5', 2) });
    expect(currentTurn()).toBe(MEMORY_FIRST_TURN + 1);
  });
});

describe('clearMemory', () => {
  it('forgets slots and resets the turn — the "new chat" contract', () => {
    mergeMemory({ grade: slot('Class 3-5', 1) });
    advanceTurn();
    clearMemory();
    expect(readMemory()).toEqual({});
    expect(currentTurn()).toBe(MEMORY_FIRST_TURN);
  });
});

describe('bounded storage', () => {
  it('keeps the most recently set slots and evicts the oldest', () => {
    const updates: SessionMemory = {};
    for (let i = 0; i < MEMORY_MAX_SLOTS + 3; i += 1) {
      updates[`slot${i}`] = slot(`value${i}`, i + 1);
    }
    mergeMemory(updates);

    const kept = Object.keys(readMemory());
    expect(kept).toHaveLength(MEMORY_MAX_SLOTS);
    expect(kept).not.toContain('slot0');
    expect(kept).toContain(`slot${MEMORY_MAX_SLOTS + 2}`);
  });
});

describe('fail-soft', () => {
  it('reads as empty when the stored payload is corrupt JSON', () => {
    window.sessionStorage.setItem(MEMORY_STORAGE_KEY, '{not json');
    expect(readMemory()).toEqual({});
    expect(currentTurn()).toBe(MEMORY_FIRST_TURN);
  });

  it('reads as empty when the stored payload is the wrong shape', () => {
    window.sessionStorage.setItem(MEMORY_STORAGE_KEY, '["not", "an", "object"]');
    expect(readMemory()).toEqual({});
  });

  it('never throws when storage access throws — private browsing', () => {
    const boom = () => {
      throw new Error('storage disabled');
    };
    vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'removeItem').mockImplementation(boom);

    expect(() => mergeMemory({ grade: slot('Class 3-5', 1) })).not.toThrow();
    expect(readMemory()).toEqual({});
    expect(() => advanceTurn()).not.toThrow();
    expect(() => clearMemory()).not.toThrow();
  });

  it('never throws when the write fails on quota', () => {
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => mergeMemory({ grade: slot('Class 3-5', 1) })).not.toThrow();
    expect(readMemory()).toEqual({});
  });
});
