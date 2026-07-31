// AI Action Router — telemetry transport (Phase 1, Milestone M8).
//
// This is the seam telemetry.ts was written to receive. Its header has said
// since M3: "M3 buffers in memory. M8 adds the transport." This is that module,
// and it deliberately did not exist earlier — call sites reviewed and correct
// before any transport exists to get them wrong is cheaper than the reverse.
//
// ─── THE TWO LAYERS, AND WHY THEY ARE SEPARATE ─────────────────────────────
//   telemetry.ts          LOCAL signal. Every individual thing that happened,
//                         buffered, bounded, drained exactly once. Fine-grained.
//   telemetryTransport.ts WIRE layer (here). Collapses a whole prefill session
//                         into AT MOST TWO events and sends them.
//
// The collapse is the entire point, not an optimisation. `Event` is a
// RARE-INCIDENT table on single-writer SQLite that also serves every
// authenticated request; a teacher who corrects six fields must not produce six
// rows. Six local `field_corrected` events become one `corrections: [...]` array
// on one outcome event. That is CHANGE-6's promise ("~one row per routed
// session") kept at the only layer that can keep it.
//
// ─── THE CEILING, STATED PRECISELY ─────────────────────────────────────────
// Per applied draft, for the lifetime of the tab:
//   * exactly one `prefill_delivered`, latched
//   * AT MOST one `prefill_outcome`, latched
// Both latches are per draft id and neither can be reset. A session that ends
// with no outcome is not a missing row — it IS the abandonment signal, derived
// server-side from the delivered event standing alone.
//
// ─── FAILURE POSTURE ───────────────────────────────────────────────────────
// Fire-and-forget. No retry, ever. A failed batch is DROPPED. Telemetry runs on
// a teacher's edit path, and a measurement that can degrade the thing it
// measures is worth less than no measurement: losing rows is always the correct
// trade against costing latency, retry storms on a poor connection, or an error
// the teacher can see.

import { ASSISTANT_ENABLED } from '../config';
import { postAssistantEvents } from './api';
import { drainTelemetry } from './telemetry';
import type { AssistantEvent, PrefillOutcome, ProvenanceSource } from './types';

/**
 * Hard cap on queued events. Two per session means this is roughly ten sessions
 * of headroom without a successful flush — far past the point where the network
 * is the problem rather than the buffer. Oldest are dropped first.
 */
const MAX_QUEUED = 20;

/**
 * sessionStorage key for drafts a `prefill_delivered` has already been sent for.
 *
 * Bug fix: `session` below is the fast, same-life-of-the-tab latch, but it is a
 * plain module variable, so a hard refresh (the JS runtime restarting with the
 * SAME `?ai=` draft still live in the draft store) reset it to null and let
 * `notePrefillDelivered` fire a second time for a draft already delivered in an
 * earlier life of this tab. This is the part of the latch that survives that —
 * sessionStorage, exactly like every other tab-scoped store in this feature, so
 * it still dies with the tab and never outlives it.
 */
const DELIVERED_STORAGE_KEY = 'ta.assistant.delivered.v1';

/** Bounded like every other store here; a session realistically delivers a handful of drafts. */
const MAX_DELIVERED = 20;

interface PrefillSession {
  draftId: string;
  actionId: string;
  requestId: string;
  fieldCount: number;
  outcomeSent: boolean;
}

let session: PrefillSession | null = null;
let queue: AssistantEvent[] = [];
let inFlight = false;

/** Reads without ever throwing — same posture as every other store in this feature. */
function readDeliveredIds(): string[] {
  try {
    const raw = window.sessionStorage.getItem(DELIVERED_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Has this draft id already had a `prefill_delivered` sent, in this tab-lifetime, refresh or not? */
function wasDelivered(draftId: string): boolean {
  return readDeliveredIds().includes(draftId);
}

/**
 * Records that this draft id has now been delivered. Never throws: a failed
 * write here costs, at worst, a duplicate row after a refresh — the exact
 * pre-fix behaviour — never a broken composer.
 */
function markDelivered(draftId: string): void {
  try {
    const ids = readDeliveredIds().filter((id) => id !== draftId);
    ids.push(draftId);
    window.sessionStorage.setItem(DELIVERED_STORAGE_KEY, JSON.stringify(ids.slice(-MAX_DELIVERED)));
  } catch {
    // Quota exceeded or storage disabled. Nothing to do; see the comment above.
  }
}

/** Queue an event, dropping the oldest if the cap is reached. Never throws. */
function enqueue(event: AssistantEvent): void {
  queue.push(event);
  if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
}

/**
 * Harvest the corrections recorded since the last drain.
 *
 * Filtered by name rather than by position, so it does not matter whether the
 * local buffer also holds the `prefill_applied` or `prefill_generated` markers —
 * this module already has that information from its own session state, and
 * discarding them here is what keeps the two layers from double-counting.
 */
function harvestCorrections(): { field: string; from: ProvenanceSource }[] {
  return drainTelemetry()
    .filter((event) => event.name === 'field_corrected' && event.field && event.from)
    .map((event) => ({ field: event.field as string, from: event.from as ProvenanceSource }));
}

/**
 * A draft was applied to the Generator's form.
 *
 * This is the DENOMINATOR of the field-edit rate, and it is reported from here
 * rather than from the server's decision because a decision the teacher never
 * saw must not inflate it. An expired draft, disabled storage, or a teacher who
 * navigated away all produce a server-side `prefill` decision and no delivery.
 *
 * Applying a second draft closes out the first: if the teacher corrected fields
 * and then routed again without generating, that first session ended as
 * `edited`, and this is the last moment it can be reported honestly.
 */
export function notePrefillDelivered(input: {
  draftId: string;
  actionId: string;
  requestId?: string;
  fieldCount: number;
  lowConfidenceCount: number;
}): void {
  if (!ASSISTANT_ENABLED) return;
  if (session && session.draftId === input.draftId) return; // already counted, this life of the tab
  if (wasDelivered(input.draftId)) return; // already counted before a refresh reset the line above

  closeOpenSession();

  session = {
    draftId: input.draftId,
    actionId: input.actionId,
    requestId: input.requestId ?? '',
    fieldCount: input.fieldCount,
    outcomeSent: false,
  };

  // Any corrections still buffered belong to whatever came before and have now
  // been reported (or discarded with it). Starting clean keeps a previous
  // session's edits from being attributed to this one.
  drainTelemetry();
  markDelivered(input.draftId);

  enqueue({
    name: 'prefill_delivered',
    actionId: input.actionId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    fieldCount: input.fieldCount,
    lowConfidenceCount: input.lowConfidenceCount,
  });
  void flush();
}

/**
 * Report how the current prefill ended. Latched: the first outcome wins.
 *
 * The latch is what makes the two-row ceiling a guarantee rather than an
 * expectation. Without it the sequence "edit a field, tab away (edited), come
 * back, press Generate (generated)" would write three rows for one session.
 */
function noteOutcome(outcome: PrefillOutcome, harvested?: { field: string; from: ProvenanceSource }[]): void {
  if (!ASSISTANT_ENABLED) return;
  if (!session || session.outcomeSent) return;

  // The buffer drains ONCE per outcome. Callers that already had to harvest in
  // order to decide whether an outcome was warranted pass what they took, so
  // those corrections are reported rather than lost to a second empty drain.
  const corrections = harvested ?? harvestCorrections();
  session.outcomeSent = true;

  enqueue({
    name: 'prefill_outcome',
    actionId: session.actionId,
    ...(session.requestId ? { requestId: session.requestId } : {}),
    outcome,
    fieldCount: session.fieldCount,
    corrections,
  });
  void flush();
}

/** The teacher pressed Generate with AI-filled fields present. The routing worked. */
export function notePrefillGenerated(): void {
  noteOutcome('generated');
}

/** The teacher pressed "Clear AI fields" — the highest-signal wrong-routing indicator. */
export function notePrefillUndone(): void {
  noteOutcome('undone');
}

/**
 * Close a session that never reached Generate or Undo.
 *
 * Reports `edited` ONLY if the teacher actually corrected something. A session
 * with no corrections and no terminal action is an abandonment, and abandonment
 * is deliberately reported by SILENCE — the server derives it from a delivered
 * event with no outcome. Emitting an explicit "nothing happened" row would cost
 * a write to say less than the absence already says.
 */
function closeOpenSession(): void {
  if (!session || session.outcomeSent) return;

  const corrections = harvestCorrections();
  if (corrections.length === 0) return;
  noteOutcome('edited', corrections);
}

/**
 * Send whatever is queued. One request in flight at a time; the rest waits for
 * the next trigger rather than piling on a connection that is already slow.
 */
export async function flush(): Promise<void> {
  if (!ASSISTANT_ENABLED || inFlight || queue.length === 0) return;

  inFlight = true;
  try {
    // DRAINS UNTIL EMPTY rather than sending one batch and returning.
    //
    // Without the loop, anything queued while a send was in flight was stranded
    // until the next trigger — and the commonest sequence in the whole feature
    // hits exactly that: the delivery flush is still open when the teacher's
    // outcome is queued a moment later, so every outcome would have waited for
    // an unrelated later event to push it out. Caught by the ceiling tests,
    // which counted one event where two were expected.
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      // The batch is DROPPED on failure, never re-queued. See the failure
      // posture note at the top: a retry loop behind a teacher's form is a worse
      // outcome than a lost row. postAssistantEvents reports delivery as a
      // boolean and nothing here acts on it.
      await postAssistantEvents({ events: batch });
    }
  } catch {
    // postAssistantEvents does not throw by contract, but this sits on a
    // teacher's edit path and "by contract" is not the same as "provably". A
    // rejected send loses its batch and nothing else.
  } finally {
    inFlight = false;
  }
}

/**
 * Best-effort final flush, called when the page is being hidden.
 *
 * `visibilitychange` rather than `unload`: on mobile Chrome — the target
 * platform — `unload` frequently never fires, while a backgrounded tab reliably
 * goes hidden. This still is not a guarantee, which is precisely why
 * abandonment is derived from absence rather than reported by a beacon.
 */
export function flushOnHide(): void {
  closeOpenSession();
  void flush();
}

/**
 * Test seam. Resets every latch and buffer, INCLUDING the persisted delivered
 * set, so cases cannot leak into each other. This is a fresh tab, not a
 * refresh of the current one — for the latter, see `simulateReload`.
 */
export function resetTelemetryTransport(): void {
  session = null;
  queue = [];
  inFlight = false;
  drainTelemetry();
  try {
    window.sessionStorage.removeItem(DELIVERED_STORAGE_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

/**
 * Test seam. Mimics a hard refresh of the SAME tab: the in-memory latch and
 * queue are gone, exactly as they are after a real reload, but sessionStorage
 * — including the persisted delivered-draft record `notePrefillDelivered` now
 * checks — survives, exactly as it does after a real reload. Exists to prove
 * the fix for the bug this file's header used to be wrong about: the ceiling
 * comment said "for the lifetime of the tab", but only `session` was ever
 * scoped to that; a refresh is still the same tab and used to reset it anyway.
 */
export function simulateReload(): void {
  session = null;
  queue = [];
  inFlight = false;
}

/** Test seam: the queued events, without sending them. */
export function peekQueue(): AssistantEvent[] {
  return [...queue];
}
