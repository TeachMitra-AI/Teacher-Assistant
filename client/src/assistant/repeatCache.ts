// AI Action Router — client repeat cache (Phase 1, Milestone M6).
//
// Tier 2 of the hybrid design: a normalized utterance the teacher has already
// used maps straight back to the decision the server made for it, with no
// network call and no model call. Teachers repeat themselves constantly —
// "make a class 5 maths worksheet" every Monday — and a repeat should cost
// nothing.
//
// ─── WHAT THIS CACHE MAY NOT DO ────────────────────────────────────────────
// It replays a SERVER decision. It never makes one. Two rules keep that true:
//
//   1. Entries are keyed by catalogVersion, so a capability change invalidates
//      every entry that predates it rather than replaying a decision the server
//      would no longer make.
//   2. A response with ANY memory-derived parameter is never cached (approved
//      decision D12). Such a decision is a function of conversation state that
//      has since moved on: caching "make one on decimals" with the grade it
//      inherited three turns ago would confidently prefill a stale class. The
//      hit-rate cost is real and the alternative — fingerprinting the whole
//      memory into the key — buys back hits that were never safe to serve.
//
// The normalized utterance is stored in sessionStorage. That is sanctioned by
// the architecture (§3.2 specifies exactly this cache) and is the same standard
// the draft store already meets: same-tab only, dies with the tab, never sent
// anywhere. Guardrail G11 is about logs, telemetry and the wire — not about the
// teacher's own browser tab.
//
// Fail-soft in every path, like the draft store: a cache problem costs a network
// call, never a working composer.

import type { ResolvedAction } from './types';

const STORAGE_KEY = 'ta.assistant.cache.v1';

/**
 * One hour. Long enough to cover a teacher's planning session, short enough that
 * a decision cannot outlive the working day it was made in.
 */
const TTL_MS = 60 * 60 * 1000;

/** Bounded storage on low-end devices. Newest kept, oldest evicted. */
const MAX_ENTRIES = 20;

interface CacheEntry {
  /** The normalized utterance — see intentGate.normalizeUtterance. */
  key: string;
  /** The catalog this decision was made against. A change invalidates the entry. */
  catalogVersion: number;
  action: ResolvedAction;
  expiresAt: number;
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
    // Quota or disabled storage. The next identical utterance simply costs a
    // network call, which is what it costs today.
  }
}

/**
 * Defensive shape check.
 *
 * Everything stored here was written from a response this client already
 * shape-checked, so the realistic failure is a hand-edited or half-written
 * record rather than a hostile one. Anything that does not carry the four fields
 * the executor depends on is dropped.
 */
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

  return {
    key: raw.key,
    catalogVersion: raw.catalogVersion,
    action: action as unknown as ResolvedAction,
    expiresAt: raw.expiresAt,
  };
}

/** Everything currently cached, oldest first. Corrupt payloads read as empty. */
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

/** Persists, dropping expired entries and keeping the newest MAX_ENTRIES. */
function saveAll(entries: CacheEntry[], now: number): void {
  const live = entries.filter((entry) => entry.expiresAt > now).slice(-MAX_ENTRIES);
  try {
    writeRaw(JSON.stringify(live));
  } catch {
    // A circular structure in params would be a caller bug rather than a
    // teacher-visible failure. Swallow it: the cache is an optimization.
  }
}

/**
 * Does any parameter of this decision come from remembered conversation state?
 *
 * The gate on caching (decision D12). `provenance` is a sibling of `params`
 * precisely so questions like this can be asked without parsing values.
 */
function derivesFromMemory(action: ResolvedAction): boolean {
  const provenance = action.provenance;
  if (typeof provenance !== 'object' || provenance === null) return false;
  return Object.values(provenance).includes('memory');
}

/**
 * The decision previously made for this utterance under this catalog, or null.
 *
 * A miss is the normal case and costs nothing to establish.
 */
export function readCached(key: string, catalogVersion: number): ResolvedAction | null {
  if (!key) return null;
  const now = Date.now();
  const entry = loadAll().find(
    (candidate) =>
      candidate.key === key &&
      candidate.catalogVersion === catalogVersion &&
      candidate.expiresAt > now
  );
  return entry ? entry.action : null;
}

/**
 * Remembers a decision, unless it is one that must not be replayed.
 *
 * Returns whether it was stored, which is what the tests assert against — the
 * caller has nothing useful to do with the answer.
 */
export function writeCached(key: string, catalogVersion: number, action: ResolvedAction): boolean {
  if (!key || !action || typeof action.actionId !== 'string') return false;
  if (derivesFromMemory(action)) return false;

  const now = Date.now();
  const entries = loadAll().filter((entry) => entry.key !== key || entry.catalogVersion !== catalogVersion);
  entries.push({ key, catalogVersion, action, expiresAt: now + TTL_MS });
  saveAll(entries, now);
  return true;
}

/** Drops everything. Used when the catalog version moves and on sign-out. */
export function clearCache(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

/** Test seams: the bounds are policy, and the tests assert the policy rather than re-declaring it. */
export const CACHE_TTL_MS = TTL_MS;
export const CACHE_MAX_ENTRIES = MAX_ENTRIES;
export const CACHE_STORAGE_KEY = STORAGE_KEY;
