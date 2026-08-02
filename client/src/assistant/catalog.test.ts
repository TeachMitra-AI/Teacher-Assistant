import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_STORAGE_KEY,
  clearCatalog,
  domainForAction,
  ensureCatalog,
  readCachedCatalog,
} from './catalog';
import type { CatalogResponse } from './types';

// The catalog exists on the client for exactly one purpose: telling the executor
// which module owns an action id this bundle has no handler for. That is the
// stale-PWA case the endpoint was kept for.
//
// Everything here is BEST-EFFORT. A catalog that cannot be fetched costs the
// unknown-id fallback and nothing else — routing itself never needs it, because
// /interpret builds its own role-filtered catalog server-side and ignores
// whatever the client claims.

const catalog: CatalogResponse = {
  catalogVersion: 1,
  actions: [
    {
      id: 'generate_assessment',
      version: 1,
      status: 'active',
      domain: 'generator',
      effect: 'draft',
      summary: 'Create a printable quiz or worksheet with an answer key.',
      examples: [],
      slots: [],
    },
    {
      id: 'open_generator',
      version: 1,
      status: 'active',
      domain: 'generator',
      effect: 'read',
      summary: 'Open the quiz and worksheet generator.',
      examples: [],
      slots: [],
    },
  ],
};

beforeEach(() => {
  window.sessionStorage.clear();
  // Also resets the in-flight de-duplication, which is module-level state.
  clearCatalog();
});

describe('ensureCatalog', () => {
  it('fetches once and caches for the session', async () => {
    const fetcher = vi.fn().mockResolvedValue(catalog);

    expect(await ensureCatalog(fetcher)).toEqual(catalog);
    expect(await ensureCatalog(fetcher)).toEqual(catalog);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent first-use fetches into one request', async () => {
    const fetcher = vi.fn().mockResolvedValue(catalog);
    await Promise.all([ensureCatalog(fetcher), ensureCatalog(fetcher), ensureCatalog(fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null and caches nothing when the fetch fails', async () => {
    expect(await ensureCatalog(vi.fn().mockResolvedValue(null))).toBeNull();
    expect(readCachedCatalog()).toBeNull();
  });

  it('returns null rather than throwing when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    await expect(ensureCatalog(fetcher)).resolves.toBeNull();
  });

  it('retries on the next call after a failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(catalog);
    expect(await ensureCatalog(fetcher)).toBeNull();
    expect(await ensureCatalog(fetcher)).toEqual(catalog);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a payload that is not a catalog', async () => {
    const fetcher = vi.fn().mockResolvedValue({ actions: [] } as unknown as CatalogResponse);
    expect(await ensureCatalog(fetcher)).toBeNull();
  });

  it('keeps the actions it understands and drops the ones it cannot use', async () => {
    const mixed = {
      catalogVersion: 2,
      actions: [
        catalog.actions[0],
        { id: 'no_domain' },
        null,
        { domain: 'library' },
      ],
    } as unknown as CatalogResponse;

    const result = await ensureCatalog(vi.fn().mockResolvedValue(mixed));
    // A newer server adding a field must not blind an older client to the
    // actions it does understand.
    expect(result!.actions).toHaveLength(1);
    expect(result!.catalogVersion).toBe(2);
  });
});

describe('domainForAction', () => {
  it('resolves a known action to its module', async () => {
    await ensureCatalog(vi.fn().mockResolvedValue(catalog));
    expect(domainForAction('generate_assessment')).toBe('generator');
    expect(domainForAction('open_generator')).toBe('generator');
  });

  it('returns null for an id the catalog does not list', async () => {
    await ensureCatalog(vi.fn().mockResolvedValue(catalog));
    expect(domainForAction('delete_all_resources')).toBeNull();
  });

  it('returns null when no catalog has been fetched, without waiting for one', () => {
    // Runs inside a navigation decision, so it must never await a network call.
    expect(domainForAction('generate_assessment')).toBeNull();
  });
});

describe('clearCatalog', () => {
  it('forces a re-fetch — the version-invalidation signal', async () => {
    const fetcher = vi.fn().mockResolvedValue(catalog);
    await ensureCatalog(fetcher);
    clearCatalog();
    await ensureCatalog(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('fail-soft', () => {
  it('reads as absent when the stored payload is corrupt', () => {
    window.sessionStorage.setItem(CATALOG_STORAGE_KEY, '{broken');
    expect(readCachedCatalog()).toBeNull();
  });

  it('never throws when storage access throws', async () => {
    const boom = () => {
      throw new Error('storage disabled');
    };
    vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(boom);
    vi.spyOn(window.sessionStorage.__proto__, 'removeItem').mockImplementation(boom);

    await expect(ensureCatalog(vi.fn().mockResolvedValue(catalog))).resolves.toEqual(catalog);
    expect(() => domainForAction('generate_assessment')).not.toThrow();
    expect(() => clearCatalog()).not.toThrow();
  });
});
