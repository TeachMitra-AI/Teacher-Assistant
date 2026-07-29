// AI Action Router — prefill draft store (Phase 1, Milestone M3).
//
// The mechanism by which a prefill travels from the router to the Generator
// WITHOUT putting the teacher's text in the URL. The page is reached as
// /generator?ai=<opaque id>; the values themselves live here, in sessionStorage.
// A topic in a query string would land in browser history, referrer headers, and
// every access log between the client and the server — see guardrail G12.
//
// sessionStorage specifically (never localStorage): it survives a refresh, which
// is what makes the "reload re-applies the prefill" behaviour possible, and it
// dies with the tab, so nothing outlives the session that created it.
//
// ─── THE FAIL-SOFT CONTRACT ────────────────────────────────────────────────
// Every function here degrades to "no draft" and NEVER throws. Quota exhaustion,
// storage disabled in private browsing, corrupt JSON, and hand-written or
// stale-shaped records are all real on the target devices (low-end Android,
// often in private tabs). The worst outcome any of them may produce is that the
// Generator opens with its normal defaults — which is exactly today's behaviour.
// A crash here would break a page that works perfectly well without the router.
//
// Note that Safari in private mode throws on ACCESS, not only on write, which is
// why even reading `window.sessionStorage` is wrapped.
//
// Nothing writes drafts until M6 (the ActionExecutor's handlers). In M3 this
// module ships inert: no ?ai= handle can exist in production, and the store is
// exercised by its unit tests and by hand-written records during verification.

import type { PrefillDraft, ProvenanceSource } from './types';

/** Single sessionStorage key holding every draft. Versioned so a future shape change can be ignored rather than mis-parsed. */
const STORAGE_KEY = 'ta.assistant.drafts.v1';

/**
 * 30 minutes. Long enough for a teacher who was interrupted between classes,
 * short enough that a forgotten tab does not silently prefill a stale topic an
 * hour later — a confident, wrong worksheet is worse than an empty form.
 */
const TTL_MS = 30 * 60 * 1000;

/**
 * Keep the newest 5. Bounded storage matters on the target devices, and there is
 * no plausible flow in which a teacher needs a sixth pending prefill.
 */
const MAX_DRAFTS = 5;

/** What a caller supplies; the store owns id, timestamps and the consumed flag. */
export interface CreateDraftInput {
  actionId: string;
  version: number;
  initialParams: Record<string, unknown>;
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields?: string[];
  /** Rendered in the banner as "Filled in from: …". Never sent back to the server. */
  utterance?: string;
  /**
   * The interpret response's correlation id, carried so telemetry about this
   * prefill can be joined to the decision that produced it (M8).
   *
   * An OPAQUE UUID minted by the server — the one identifier that crosses the
   * two telemetry channels. It carries nothing teacher-derived, which is what
   * makes it safe to send back; `utterance` above sits in the same record and
   * must never follow it.
   */
  requestId?: string;
}

/**
 * Reads sessionStorage without ever throwing. Returns null when storage is
 * unavailable for any reason, which callers treat identically to "empty".
 */
function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Writes sessionStorage without ever throwing. Returns false if the write did not happen. */
function writeRaw(value: string): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    // Quota exceeded, or storage disabled. The draft simply will not be
    // available later, and the Generator will open with its defaults.
    return false;
  }
}

/**
 * Defensive shape check on a stored record.
 *
 * Deliberately forgiving about optional fields and strict about the ones the
 * Generator actually depends on. Two real cases need this tolerance: records
 * hand-written during verification, and — once the feature ships — a
 * service-worker-cached client reading a draft written by a newer build. Both
 * should degrade field-by-field rather than discarding the whole prefill.
 */
function toDraft(value: unknown): PrefillDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.actionId !== 'string' || raw.actionId === '') return null;
  if (typeof raw.initialParams !== 'object' || raw.initialParams === null) return null;
  if (Array.isArray(raw.initialParams)) return null;
  if (typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt)) return null;

  const provenance =
    typeof raw.provenance === 'object' && raw.provenance !== null && !Array.isArray(raw.provenance)
      ? (raw.provenance as Record<string, ProvenanceSource>)
      : {};

  return {
    id: raw.id,
    actionId: raw.actionId,
    version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
    initialParams: raw.initialParams as Record<string, unknown>,
    provenance,
    lowConfidenceFields: Array.isArray(raw.lowConfidenceFields)
      ? raw.lowConfidenceFields.filter((f): f is string => typeof f === 'string')
      : [],
    utterance: typeof raw.utterance === 'string' ? raw.utterance : '',
    // Absent on hand-written drafts and on records written before M8. Telemetry
    // treats the empty string as "cannot be joined", which the metrics script
    // excludes from the abandonment denominator rather than guessing about.
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    expiresAt: raw.expiresAt,
    consumed: raw.consumed === true,
  };
}

/**
 * Every currently-stored draft, oldest first. Corrupt JSON, a non-array payload,
 * and individually malformed entries all resolve to "nothing usable" rather than
 * to an exception.
 */
function loadAll(): PrefillDraft[] {
  const raw = readRaw();
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map(toDraft).filter((d): d is PrefillDraft => d !== null);
}

/** Persists the list, dropping expired entries and keeping only the newest MAX_DRAFTS. */
function saveAll(drafts: PrefillDraft[], now: number): boolean {
  const live = drafts.filter((d) => d.expiresAt > now).slice(-MAX_DRAFTS);
  try {
    return writeRaw(JSON.stringify(live));
  } catch {
    // JSON.stringify can throw on a circular structure in initialParams. That
    // would be a caller bug, but it must not surface as a broken composer.
    return false;
  }
}

/**
 * An opaque, non-guessable handle. Never meaningful, never derived from the
 * teacher's text — it is the only part of a prefill that appears in the URL.
 * Falls back to Math.random on the older WebViews still in the target fleet,
 * where the value's unguessability is a nicety rather than a security control:
 * the draft never leaves this browser tab.
 */
function newId(): string {
  try {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  }
}

/**
 * Stores a prefill and returns its handle, or null if it could not be stored.
 *
 * A null return is not an error to report — the caller should navigate without
 * the ?ai= handle, landing the teacher on a normal empty Generator.
 */
export function createDraft(input: CreateDraftInput): string | null {
  const now = Date.now();
  const draft: PrefillDraft = {
    id: newId(),
    actionId: input.actionId,
    version: input.version,
    // Copied on the way in and re-parsed on the way out, so the stored
    // initialParams cannot be mutated through any reference a caller holds.
    // Refresh semantics depend on these values staying exactly as resolved.
    initialParams: { ...input.initialParams },
    provenance: { ...input.provenance },
    lowConfidenceFields: [...(input.lowConfidenceFields ?? [])],
    utterance: input.utterance ?? '',
    requestId: input.requestId ?? '',
    createdAt: now,
    expiresAt: now + TTL_MS,
    consumed: false,
  };

  if (!saveAll([...loadAll(), draft], now)) return null;
  return draft.id;
}

/**
 * The draft for a handle, or null when there is nothing to apply.
 *
 * Expired and consumed drafts both read as null: the Generator's behaviour is
 * identical in every "no usable draft" case — open with its normal defaults —
 * so distinguishing them at the call site would be a branch with one outcome.
 *
 * Each call re-parses from storage, so the returned object is a fresh copy and
 * mutating it cannot corrupt the stored record.
 */
export function readDraft(id: string): PrefillDraft | null {
  if (!id) return null;
  const now = Date.now();
  const draft = loadAll().find((d) => d.id === id);
  if (!draft) return null;
  if (draft.consumed) return null;
  if (draft.expiresAt <= now) return null;
  return draft;
}

/**
 * Marks a draft spent, after "Clear AI fields". A later refresh then loads plain
 * defaults instead of re-applying values the teacher explicitly rejected.
 *
 * Silently does nothing when the draft is already gone — undo must never fail.
 */
export function markConsumed(id: string): void {
  if (!id) return;
  const now = Date.now();
  const drafts = loadAll();
  const target = drafts.find((d) => d.id === id);
  if (!target || target.consumed) return;
  target.consumed = true;
  saveAll(drafts, now);
}

/** Test seam: TTL and retention are policy, and the tests assert the policy rather than re-declaring it. */
export const DRAFT_TTL_MS = TTL_MS;
export const DRAFT_RETENTION = MAX_DRAFTS;
export const DRAFT_STORAGE_KEY = STORAGE_KEY;
