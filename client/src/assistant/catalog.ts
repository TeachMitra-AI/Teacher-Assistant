// AI Action Router — client catalog cache (Phase 1, Milestone M6).
//
// The catalog answers one question the client genuinely cannot answer for
// itself: WHICH DOMAIN does an action id belong to? That matters only in the
// case the whole endpoint was kept for — a service-worker-cached client meeting
// an action id its handler map has never heard of. Knowing the domain turns that
// from "nothing happens" into "the teacher lands on the right module's home
// page", with no client release.
//
// ─── LAZY, NOT EAGER ───────────────────────────────────────────────────────
// Fetched on the first utterance that passes the intent gate, never on mount. A
// teacher who only ever asks coaching questions makes ZERO assistant requests
// for their whole session, which is both the polite behaviour on a 2G
// connection and what makes the flags-off network trace trivially provable.
//
// ─── BEST-EFFORT, ALWAYS ───────────────────────────────────────────────────
// Nothing here may block or fail a routing. A catalog that cannot be fetched
// costs the unknown-id fallback and nothing else; routing itself does not need
// it, because /interpret builds its own role-filtered catalog server-side and
// never trusts anything the client sends about capabilities.

import { fetchCatalog as defaultFetchCatalog } from './api';
import type { CatalogResponse } from './types';

const STORAGE_KEY = 'ta.assistant.catalog.v1';

/** De-dupes concurrent first-use fetches so two quick submissions cost one request. */
let inFlight: Promise<CatalogResponse | null> | null = null;

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable. The catalog is re-fetched next time, which costs one
    // request per routed utterance rather than one per session — acceptable for
    // a degraded browser, and invisible to the teacher.
  }
}

/**
 * Defensive shape check.
 *
 * Only the two fields this module uses are required. Actions missing an `id` or
 * a `domain` are dropped individually rather than rejecting the whole payload:
 * a newer server adding a field must not blind an older client to the actions it
 * does understand.
 */
function toCatalog(value: unknown): CatalogResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.catalogVersion !== 'number' || !Number.isFinite(raw.catalogVersion)) return null;
  if (!Array.isArray(raw.actions)) return null;

  const actions = raw.actions.filter((action): action is CatalogResponse['actions'][number] => {
    if (typeof action !== 'object' || action === null || Array.isArray(action)) return false;
    const candidate = action as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.domain === 'string';
  });

  return { catalogVersion: raw.catalogVersion, actions };
}

/** The catalog stored for this session, or null. */
export function readCachedCatalog(): CatalogResponse | null {
  const raw = readRaw();
  if (raw === null) return null;
  try {
    return toCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The catalog, fetching it once per session if it is not already cached.
 *
 * The fetcher is injected so the module is testable without a network or a
 * token; production callers pass nothing.
 */
export async function ensureCatalog(
  fetcher: () => Promise<CatalogResponse | null> = defaultFetchCatalog
): Promise<CatalogResponse | null> {
  const cached = readCachedCatalog();
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const fetched = await fetcher();
      const catalog = toCatalog(fetched);
      if (catalog) {
        try {
          writeRaw(JSON.stringify(catalog));
        } catch {
          // Unserializable payload: keep it for this call, store nothing.
        }
      }
      return catalog;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Which module owns this action id, according to the server.
 *
 * Reads only what is already cached — the unknown-id fallback runs inside a
 * navigation decision and must not wait on a network call to make it.
 */
export function domainForAction(actionId: string): string | null {
  if (!actionId) return null;
  const catalog = readCachedCatalog();
  if (!catalog) return null;
  const action = catalog.actions.find((candidate) => candidate.id === actionId);
  return action ? action.domain : null;
}

/**
 * Forgets the cached catalog.
 *
 * Called when an /interpret response reports a catalogVersion different from the
 * cached one — that is the signal the spec kept this endpoint for, and it is how
 * a stale PWA client learns its assumptions are void. The next routed utterance
 * re-fetches.
 */
export function clearCatalog(): void {
  inFlight = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

/** Test seam. */
export const CATALOG_STORAGE_KEY = STORAGE_KEY;
