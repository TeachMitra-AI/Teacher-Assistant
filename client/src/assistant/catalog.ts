// Session cache of the server's action catalog. The client only needs it to map an action id to its domain, so a
// cached PWA client that meets an id it has no handler for can still land the teacher on the right module.
// Fetched lazily on the first utterance that passes the intent gate, never on mount, so coaching-only sessions make no
// assistant requests. Best-effort: routing itself doesn't need it, since /interpret builds its own catalog server-side.

import { fetchCatalog as defaultFetchCatalog } from './api';
import type { CatalogResponse } from './types';

const STORAGE_KEY = 'ta.assistant.catalog.v1';

// De-dupes concurrent first-use fetches.
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
    // Storage unavailable: the catalog is just re-fetched next time.
  }
}

// Only `id` and `domain` are required. Bad actions are dropped one by one, so a newer server adding a field
// doesn't blind an older client to the actions it does understand.
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

export function readCachedCatalog(): CatalogResponse | null {
  const raw = readRaw();
  if (raw === null) return null;
  try {
    return toCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Fetches once per session. The fetcher is injectable for tests.
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

// Reads only the cache: the unknown-id fallback runs during a navigation decision and can't wait on the network.
export function domainForAction(actionId: string): string | null {
  if (!actionId) return null;
  const catalog = readCachedCatalog();
  if (!catalog) return null;
  const action = catalog.actions.find((candidate) => candidate.id === actionId);
  return action ? action.domain : null;
}

// Called when /interpret reports a different catalogVersion, meaning this client's assumptions are stale;
// the next routed utterance re-fetches.
export function clearCatalog(): void {
  inFlight = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

// Test seam.
export const CATALOG_STORAGE_KEY = STORAGE_KEY;
