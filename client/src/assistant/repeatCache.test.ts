import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_ENTRIES,
  CACHE_STORAGE_KEY,
  CACHE_TTL_MS,
  clearCache,
  readCached,
  writeCached,
} from './repeatCache';
import type { ProvenanceSource, ResolvedAction } from './types';

// The cache REPLAYS a server decision; it never makes one. Two rules keep that
// true and both have a test that fails if the rule is removed:
//
//   1. Entries are keyed by catalogVersion, so a capability change cannot be
//      served a decision made against the previous catalog.
//   2. A decision with any memory-derived parameter is never stored (approved
//      decision D12) — such a decision is a function of conversation state that
//      has since moved on.

function action(provenance: Record<string, ProvenanceSource> = { topic: 'utterance' }): ResolvedAction {
  return {
    actionId: 'generate_assessment',
    version: 1,
    effect: 'draft',
    decision: 'prefill',
    confidence: 'high',
    params: { format: 'worksheet', topic: 'Fractions' },
    provenance,
    missing: [],
    lowConfidenceFields: [],
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('readCached / writeCached', () => {
  it('round-trips a decision for the same utterance and catalog', () => {
    expect(writeCached('make a worksheet', 1, action())).toBe(true);
    expect(readCached('make a worksheet', 1)).toEqual(action());
  });

  it('misses for an utterance that was never cached', () => {
    writeCached('make a worksheet', 1, action());
    expect(readCached('make a quiz', 1)).toBeNull();
  });

  it('misses when the catalog version has moved on', () => {
    writeCached('make a worksheet', 1, action());
    // The capability set changed; the stored decision may no longer be one the
    // server would make, so it must not be replayed.
    expect(readCached('make a worksheet', 2)).toBeNull();
  });

  it('replaces rather than duplicates the same key under the same version', () => {
    writeCached('make a worksheet', 1, action({ topic: 'utterance' }));
    writeCached('make a worksheet', 1, action({ topic: 'utterance', grade: 'profile' }));
    const stored = JSON.parse(window.sessionStorage.getItem(CACHE_STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(readCached('make a worksheet', 1)!.provenance.grade).toBe('profile');
  });

  it('ignores an empty key and a malformed action', () => {
    expect(writeCached('', 1, action())).toBe(false);
    expect(writeCached('x', 1, {} as ResolvedAction)).toBe(false);
    expect(readCached('', 1)).toBeNull();
  });
});

describe('memory-derived decisions are never cached (decision D12)', () => {
  it('refuses to store a decision with any memory provenance', () => {
    const inherited = action({ topic: 'utterance', grade: 'memory' });
    expect(writeCached('now make one on decimals', 1, inherited)).toBe(false);
    expect(readCached('now make one on decimals', 1)).toBeNull();
  });

  it('stores a decision built from the utterance, profile and defaults', () => {
    const standalone = action({ topic: 'utterance', grade: 'profile', difficulty: 'default' });
    expect(writeCached('make a class 5 worksheet', 1, standalone)).toBe(true);
    expect(readCached('make a class 5 worksheet', 1)).not.toBeNull();
  });
});

describe('expiry and eviction', () => {
  it('misses once the entry has outlived its TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T09:00:00Z'));
    writeCached('make a worksheet', 1, action());
    expect(readCached('make a worksheet', 1)).not.toBeNull();

    vi.setSystemTime(new Date('2026-07-28T09:00:00Z').getTime() + CACHE_TTL_MS + 1);
    expect(readCached('make a worksheet', 1)).toBeNull();
  });

  it('keeps the newest entries and evicts the oldest', () => {
    for (let i = 0; i < CACHE_MAX_ENTRIES + 3; i += 1) {
      writeCached(`utterance ${i}`, 1, action());
    }
    const stored = JSON.parse(window.sessionStorage.getItem(CACHE_STORAGE_KEY)!);
    expect(stored).toHaveLength(CACHE_MAX_ENTRIES);
    expect(readCached('utterance 0', 1)).toBeNull();
    expect(readCached(`utterance ${CACHE_MAX_ENTRIES + 2}`, 1)).not.toBeNull();
  });
});

describe('clearCache', () => {
  it('drops everything', () => {
    writeCached('make a worksheet', 1, action());
    clearCache();
    expect(readCached('make a worksheet', 1)).toBeNull();
  });
});

describe('fail-soft', () => {
  it('reads as a miss when the payload is corrupt JSON', () => {
    window.sessionStorage.setItem(CACHE_STORAGE_KEY, 'not json at all');
    expect(readCached('make a worksheet', 1)).toBeNull();
  });

  it('reads as a miss when the payload is not an array', () => {
    window.sessionStorage.setItem(CACHE_STORAGE_KEY, '{"key":"make a worksheet"}');
    expect(readCached('make a worksheet', 1)).toBeNull();
  });

  it('drops individually malformed entries and keeps usable ones', () => {
    const usable = {
      key: 'make a worksheet',
      catalogVersion: 1,
      action: action(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    window.sessionStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify([{ key: 'broken' }, null, 'string', usable])
    );
    expect(readCached('make a worksheet', 1)).not.toBeNull();
  });

  it('never throws when storage access throws', () => {
    const boom = () => {
      throw new Error('storage disabled');
    };
    vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'removeItem').mockImplementation(boom);

    expect(() => writeCached('make a worksheet', 1, action())).not.toThrow();
    expect(readCached('make a worksheet', 1)).toBeNull();
    expect(() => clearCache()).not.toThrow();
  });
});
