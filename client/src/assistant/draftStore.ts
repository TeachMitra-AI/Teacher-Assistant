// Carries a prefill from the router to the Generator without putting the teacher's text in the URL: the page opens as
// /generator?ai=<opaque id> and the values live here in sessionStorage. A topic in a query string would land in browser
// history, referrer headers and access logs. sessionStorage (not localStorage) survives a refresh so the prefill
// re-applies, and dies with the tab.
// Fails soft: every function degrades to "no draft" and never throws (quota, private browsing, corrupt or stale records),
// so the worst case is the Generator opening with its normal defaults. Safari private mode throws on access, not only
// on write, so even reading `window.sessionStorage` is wrapped.

import type { PrefillDraft, ProvenanceSource } from './types';

// Versioned so a future shape change can be ignored rather than mis-parsed.
const STORAGE_KEY = 'ta.assistant.drafts.v1';

// 30 minutes: covers an interruption between classes, but a forgotten tab shouldn't prefill a stale topic later.
const TTL_MS = 30 * 60 * 1000;

// Keep the newest 5; bounded storage matters on low-end devices.
const MAX_DRAFTS = 5;

// What a caller supplies; the store owns id, timestamps and the consumed flag.
export interface CreateDraftInput {
  actionId: string;
  version: number;
  initialParams: Record<string, unknown>;
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields?: string[];
  /** Shown in the banner as "Filled in from: …". Never sent back to the server. */
  utterance?: string;
  /**
   * The interpret response's correlation id, so prefill telemetry can join back to the decision. An opaque server-minted
   * UUID with nothing teacher-derived in it; `utterance` sits in the same record and must never follow it.
   */
  requestId?: string;
}

// Returns null when storage is unavailable, which callers treat as empty.
function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    // Quota exceeded or storage disabled; the Generator just opens with its defaults.
    return false;
  }
}

// Strict about the fields the Generator depends on, forgiving about optional ones, so hand-written records or a draft
// written by a newer build degrade field by field instead of losing the whole prefill.
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
    // Absent on hand-written drafts; telemetry treats "" as unjoinable and excludes it from the abandonment denominator.
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    expiresAt: raw.expiresAt,
    consumed: raw.consumed === true,
  };
}

// Corrupt JSON, a non-array payload and malformed entries all resolve to "nothing usable".
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

function saveAll(drafts: PrefillDraft[], now: number): boolean {
  const live = drafts.filter((d) => d.expiresAt > now).slice(-MAX_DRAFTS);
  try {
    return writeRaw(JSON.stringify(live));
  } catch {
    // A circular structure in initialParams would be a caller bug; it must not break the composer.
    return false;
  }
}

// Opaque, non-guessable handle; the only part of a prefill that appears in the URL. Falls back to Math.random on old
// WebViews, where unguessability is a nicety since the draft never leaves the tab.
function newId(): string {
  try {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  }
}

// A null return means it couldn't be stored; the caller navigates without ?ai= and lands on a normal empty Generator.
export function createDraft(input: CreateDraftInput): string | null {
  const now = Date.now();
  const draft: PrefillDraft = {
    id: newId(),
    actionId: input.actionId,
    version: input.version,
    // Copied in and re-parsed out so callers can't mutate stored params; refresh relies on them staying as resolved.
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

// Expired and consumed drafts both read as null: the Generator behaves the same in every "no usable draft" case.
// Each call re-parses storage, so the returned object is a fresh copy.
export function readDraft(id: string): PrefillDraft | null {
  if (!id) return null;
  const now = Date.now();
  const draft = loadAll().find((d) => d.id === id);
  if (!draft) return null;
  if (draft.consumed) return null;
  if (draft.expiresAt <= now) return null;
  return draft;
}

// Marks a draft spent after "Clear AI fields", so a refresh doesn't re-apply rejected values. No-op if already gone.
export function markConsumed(id: string): void {
  if (!id) return;
  const now = Date.now();
  const drafts = loadAll();
  const target = drafts.find((d) => d.id === id);
  if (!target || target.consumed) return;
  target.consumed = true;
  saveAll(drafts, now);
}

// Test seams: tests assert TTL and retention rather than redeclare them.
export const DRAFT_TTL_MS = TTL_MS;
export const DRAFT_RETENTION = MAX_DRAFTS;
export const DRAFT_STORAGE_KEY = STORAGE_KEY;
