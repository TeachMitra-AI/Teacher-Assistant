import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDraft,
  readDraft,
  markConsumed,
  DRAFT_TTL_MS,
  DRAFT_RETENTION,
  DRAFT_STORAGE_KEY,
} from './draftStore';

// The draft store's defining property is that it FAILS SOFT. Every degraded
// path below — quota exhaustion, storage disabled, corrupt JSON, a malformed or
// hand-written record — must resolve to "no draft" so the Generator opens with
// its normal defaults, which is exactly today's behaviour. None of them may
// throw: a crash here would break a page that works fine without the router.
//
// These are not hypothetical cases. Private browsing and tight quotas are
// routine on the low-end Android devices this product targets.

const validInput = {
  actionId: 'generate_assessment',
  version: 1,
  initialParams: { format: 'worksheet', topic: 'Fractions', questionCount: 10 },
  provenance: { format: 'utterance' as const, topic: 'utterance' as const, questionCount: 'default' as const },
  lowConfidenceFields: ['grade'],
  utterance: 'Generate a Class 5 fractions worksheet',
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createDraft / readDraft', () => {
  it('round-trips a draft and returns an opaque handle', () => {
    const id = createDraft(validInput);
    expect(id).toBeTruthy();

    const draft = readDraft(id!);
    expect(draft).not.toBeNull();
    expect(draft!.actionId).toBe('generate_assessment');
    expect(draft!.initialParams).toEqual(validInput.initialParams);
    expect(draft!.provenance).toEqual(validInput.provenance);
    expect(draft!.lowConfidenceFields).toEqual(['grade']);
    expect(draft!.consumed).toBe(false);
  });

  it('generates an id that carries no teacher text', () => {
    const id = createDraft(validInput)!;
    // The handle is the only part of a prefill that reaches the URL, so it must
    // not leak the topic or the utterance (guardrail G12).
    expect(id.toLowerCase()).not.toContain('fraction');
    expect(id.toLowerCase()).not.toContain('worksheet');
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('gives distinct handles to successive drafts', () => {
    const ids = new Set([createDraft(validInput), createDraft(validInput), createDraft(validInput)]);
    expect(ids.size).toBe(3);
  });

  it('returns null for an unknown handle', () => {
    createDraft(validInput);
    expect(readDraft('nope')).toBeNull();
  });

  it('returns null for an empty handle without touching storage', () => {
    expect(readDraft('')).toBeNull();
  });

  it('isolates the stored record from later mutation of the returned object', () => {
    // Refresh semantics depend on initialParams staying exactly as resolved, so
    // a caller that mutates what it read must not corrupt what is stored.
    const id = createDraft(validInput)!;
    const first = readDraft(id)!;
    (first.initialParams as Record<string, unknown>).topic = 'Mutated';
    first.lowConfidenceFields.push('subject');

    const second = readDraft(id)!;
    expect(second.initialParams.topic).toBe('Fractions');
    expect(second.lowConfidenceFields).toEqual(['grade']);
  });

  it('isolates the stored record from later mutation of the input object', () => {
    const input = { ...validInput, initialParams: { ...validInput.initialParams } };
    const id = createDraft(input)!;
    input.initialParams.topic = 'Mutated after creation';

    expect(readDraft(id)!.initialParams.topic).toBe('Fractions');
  });
});

describe('expiry', () => {
  it('reads back a draft that is still inside its TTL', () => {
    vi.useFakeTimers();
    const id = createDraft(validInput)!;
    vi.advanceTimersByTime(DRAFT_TTL_MS - 1000);
    expect(readDraft(id)).not.toBeNull();
  });

  it('treats a draft past its TTL as absent', () => {
    vi.useFakeTimers();
    const id = createDraft(validInput)!;
    vi.advanceTimersByTime(DRAFT_TTL_MS + 1);
    // A stale topic is worse than none — it produces a confident, wrong worksheet.
    expect(readDraft(id)).toBeNull();
  });

  it('treats a draft as absent exactly at its expiry instant', () => {
    vi.useFakeTimers();
    const id = createDraft(validInput)!;
    vi.advanceTimersByTime(DRAFT_TTL_MS);
    expect(readDraft(id)).toBeNull();
  });
});

describe('retention and eviction', () => {
  it('keeps only the newest DRAFT_RETENTION drafts', () => {
    const ids = Array.from({ length: DRAFT_RETENTION + 3 }, () => createDraft(validInput)!);

    // The oldest three are evicted; the newest DRAFT_RETENTION survive.
    for (const evicted of ids.slice(0, 3)) expect(readDraft(evicted)).toBeNull();
    for (const kept of ids.slice(3)) expect(readDraft(kept)).not.toBeNull();
  });

  it('bounds what is actually written to storage', () => {
    for (let i = 0; i < DRAFT_RETENTION + 5; i += 1) createDraft(validInput);
    const stored = JSON.parse(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)!);
    expect(stored).toHaveLength(DRAFT_RETENTION);
  });

  it('purges expired drafts on the next write rather than accumulating them', () => {
    vi.useFakeTimers();
    createDraft(validInput);
    vi.advanceTimersByTime(DRAFT_TTL_MS + 1);
    createDraft(validInput);

    const stored = JSON.parse(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
  });
});

describe('markConsumed', () => {
  it('makes a consumed draft read as absent', () => {
    // "Clear AI fields" must not be undone by a refresh re-applying the values
    // the teacher just rejected.
    const id = createDraft(validInput)!;
    markConsumed(id);
    expect(readDraft(id)).toBeNull();
  });

  it('leaves other drafts usable', () => {
    const first = createDraft(validInput)!;
    const second = createDraft(validInput)!;
    markConsumed(first);
    expect(readDraft(second)).not.toBeNull();
  });

  it('does nothing and does not throw for an unknown or empty handle', () => {
    expect(() => markConsumed('nope')).not.toThrow();
    expect(() => markConsumed('')).not.toThrow();
  });

  it('is idempotent', () => {
    const id = createDraft(validInput)!;
    markConsumed(id);
    expect(() => markConsumed(id)).not.toThrow();
    expect(readDraft(id)).toBeNull();
  });
});

describe('fail-soft: storage unavailable', () => {
  it('returns null from createDraft when writing throws (quota exceeded)', () => {
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    // A null handle is a normal outcome, not an error: the caller navigates
    // without ?ai= and the teacher gets an ordinary empty Generator.
    expect(createDraft(validInput)).toBeNull();
  });

  it('returns null from readDraft when reading throws (private browsing)', () => {
    const id = createDraft(validInput)!;
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(readDraft(id)).toBeNull();
  });

  it('does not throw from markConsumed when storage is unavailable', () => {
    const id = createDraft(validInput)!;
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => markConsumed(id)).not.toThrow();
  });

  it('still produces a handle when crypto is unavailable', () => {
    vi.spyOn(window.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('no crypto');
    });

    const id = createDraft(validInput);
    expect(id).toBeTruthy();
    expect(readDraft(id!)).not.toBeNull();
  });
});

describe('fail-soft: corrupt or foreign storage contents', () => {
  it('treats unparseable JSON as empty', () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, '{not json');
    expect(readDraft('anything')).toBeNull();
  });

  it('treats a non-array payload as empty', () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ drafts: [] }));
    expect(readDraft('anything')).toBeNull();
  });

  it('recovers by overwriting corrupt contents on the next write', () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, '{not json');
    const id = createDraft(validInput);
    expect(id).toBeTruthy();
    expect(readDraft(id!)).not.toBeNull();
  });

  it.each([
    ['missing id', { actionId: 'generate_assessment', initialParams: {}, expiresAt: Date.now() + 1000 }],
    ['missing actionId', { id: 'abc', initialParams: {}, expiresAt: Date.now() + 1000 }],
    ['missing initialParams', { id: 'abc', actionId: 'generate_assessment', expiresAt: Date.now() + 1000 }],
    ['array initialParams', { id: 'abc', actionId: 'x', initialParams: [], expiresAt: Date.now() + 1000 }],
    ['missing expiresAt', { id: 'abc', actionId: 'generate_assessment', initialParams: {} }],
    ['null entry', null],
    ['string entry', 'nonsense'],
  ])('discards a malformed record: %s', (_label, record) => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([record]));
    expect(() => readDraft('abc')).not.toThrow();
    expect(readDraft('abc')).toBeNull();
  });

  it('keeps a valid record alongside a malformed sibling', () => {
    // One bad entry must not discard the whole store — a stale-PWA client
    // reading a newer draft shape is an everyday occurrence once this ships.
    const id = createDraft(validInput)!;
    const stored = JSON.parse(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)!);
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([{ junk: true }, ...stored]));

    expect(readDraft(id)).not.toBeNull();
  });

  it('accepts a hand-written record that omits optional fields', () => {
    // Manual verification writes records by hand, and so does the M3 gate.
    // Required fields are strict; optional ones default rather than reject.
    window.sessionStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'handwritten',
          actionId: 'generate_assessment',
          initialParams: { topic: 'Photosynthesis' },
          expiresAt: Date.now() + 60_000,
        },
      ]),
    );

    const draft = readDraft('handwritten');
    expect(draft).not.toBeNull();
    expect(draft!.version).toBe(1);
    expect(draft!.provenance).toEqual({});
    expect(draft!.lowConfidenceFields).toEqual([]);
    expect(draft!.utterance).toBe('');
    expect(draft!.consumed).toBe(false);
  });
});
