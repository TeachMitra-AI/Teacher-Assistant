// Repeat cache: a normalized utterance the teacher has used before maps straight back to the server's earlier decision,
// with no network or model call. It replays a server decision and never makes one, so:
//  - entries are keyed by catalogVersion, so a capability change invalidates them;
//  - a response with any memory-derived param is never cached, since it depends on conversation state that has moved on
//    (caching "make one on decimals" with a grade inherited three turns ago would prefill a stale class).
// Lives in sessionStorage (same-tab only, dies with the tab, never sent anywhere). Fails soft: a cache problem costs a
// network call, never the composer.

import type { ResolvedAction, SessionMemory } from './types';

const STORAGE_KEY = 'ta.assistant.cache.v1';

// One hour: covers a planning session without outliving the working day.
const TTL_MS = 60 * 60 * 1000;

// Bounded for low-end devices; newest kept.
const MAX_ENTRIES = 20;

interface CacheEntry {
  /** The normalized utterance (see intentGate.normalizeUtterance). */
  key: string;
  /** The catalog this decision was made against. */
  catalogVersion: number;
  action: ResolvedAction;
  expiresAt: number;
  /**
   * The `memoryUpdates` returned with this decision. Replayed on a hit so a value the teacher stated once keeps being
   * remembered on repeats, since the hit skips the network path that normally writes memory.
   */
  memoryUpdates?: SessionMemory;
}

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
    // Quota or disabled storage; the next identical utterance just costs a network call.
  }
}

// Defensive shape check: anything without the fields the executor depends on is dropped.
function toEntry(value: unknown): CacheEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.key !== 'string' || raw.key === '') return null;
  if (typeof raw.catalogVersion !== 'number' || !Number.isFinite(raw.catalogVersion)) return null;
  if (typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt)) return null;

  const action = raw.action;
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return null;
  const candidate = action as Record<string, unknown>;
  if (typeof candidate.actionId !== 'string' || candidate.actionId === '') return null;
  if (typeof candidate.decision !== 'string' || candidate.decision === '') return null;
  if (typeof candidate.params !== 'object' || candidate.params === null) return null;

  // Shape-only: per-slot validation is mergeMemory's job on replay, and bad memory shouldn't drop the decision itself.
  const memoryUpdates =
    typeof raw.memoryUpdates === 'object' && raw.memoryUpdates !== null && !Array.isArray(raw.memoryUpdates)
      ? (raw.memoryUpdates as SessionMemory)
      : undefined;

  return {
    key: raw.key,
    catalogVersion: raw.catalogVersion,
    action: action as unknown as ResolvedAction,
    expiresAt: raw.expiresAt,
    ...(memoryUpdates ? { memoryUpdates } : {}),
  };
}

function loadAll(): CacheEntry[] {
  const raw = readRaw();
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map(toEntry).filter((entry): entry is CacheEntry => entry !== null);
}

function saveAll(entries: CacheEntry[], now: number): void {
  const live = entries.filter((entry) => entry.expiresAt > now).slice(-MAX_ENTRIES);
  try {
    writeRaw(JSON.stringify(live));
  } catch {
    // A circular structure would be a caller bug; swallow it since the cache is only an optimization.
  }
}

// The gate on caching. `provenance` sits beside `params` so this can be answered without parsing values.
function derivesFromMemory(action: ResolvedAction): boolean {
  const provenance = action.provenance;
  if (typeof provenance !== 'object' || provenance === null) return false;
  return Object.values(provenance).includes('memory');
}

// Shared lookup for `readCached` and `readCachedMemoryUpdates`.
function findEntry(key: string, catalogVersion: number): CacheEntry | null {
  if (!key) return null;
  const now = Date.now();
  return (
    loadAll().find(
      (candidate) =>
        candidate.key === key && candidate.catalogVersion === catalogVersion && candidate.expiresAt > now
    ) ?? null
  );
}

export function readCached(key: string, catalogVersion: number): ResolvedAction | null {
  return findEntry(key, catalogVersion)?.action ?? null;
}

/** The `memoryUpdates` stored with the decision; callers pass them to `mergeMemory` on a hit. */
export function readCachedMemoryUpdates(key: string, catalogVersion: number): SessionMemory | undefined {
  return findEntry(key, catalogVersion)?.memoryUpdates;
}

/** Remembers a decision unless it must not be replayed. Returns whether it was stored. */
export function writeCached(
  key: string,
  catalogVersion: number,
  action: ResolvedAction,
  memoryUpdates?: SessionMemory
): boolean {
  if (!key || !action || typeof action.actionId !== 'string') return false;
  if (derivesFromMemory(action)) return false;

  const now = Date.now();
  const entries = loadAll().filter((entry) => entry.key !== key || entry.catalogVersion !== catalogVersion);
  const hasMemoryUpdates =
    memoryUpdates && typeof memoryUpdates === 'object' && Object.keys(memoryUpdates).length > 0;
  entries.push({
    key,
    catalogVersion,
    action,
    expiresAt: now + TTL_MS,
    ...(hasMemoryUpdates ? { memoryUpdates } : {}),
  });
  saveAll(entries, now);
  return true;
}

export function clearCache(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already unreachable.
  }
}

// Test seams: tests assert the bounds rather than redeclare them.
export const CACHE_TTL_MS = TTL_MS;
export const CACHE_MAX_ENTRIES = MAX_ENTRIES;
export const CACHE_STORAGE_KEY = STORAGE_KEY;
