// Wire layer over telemetry.ts: collapses a prefill session into at most two events (`prefill_delivered`, then one
// `prefill_outcome` carrying all field corrections) and sends them. `Event` is a rare-incident table on
// single-writer SQLite, so six corrected fields must not become six rows. Both events are latched per draft id.
// A session with no outcome is the abandonment signal; the server derives it from the lone delivered event.
// Fire-and-forget: no retries, a failed batch is dropped, since telemetry must never slow or break the edit path.

import { ASSISTANT_ENABLED } from '../config';
import { postAssistantEvents } from './api';
import { drainTelemetry } from './telemetry';
import type { AssistantEvent, PrefillOutcome, ProvenanceSource } from './types';

// Hard cap on queued events (about ten sessions); oldest are dropped first.
const MAX_QUEUED = 20;

// Draft ids already reported as delivered. `session` is reset by a hard refresh while the same `?ai=` draft is
// still live, which would report it twice; sessionStorage survives the refresh and still dies with the tab.
const DELIVERED_STORAGE_KEY = 'ta.assistant.delivered.v1';

// Bounded like the other stores here.
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

function wasDelivered(draftId: string): boolean {
  return readDeliveredIds().includes(draftId);
}

// A failed write can at worst cause a duplicate row after a refresh, never a broken composer.
function markDelivered(draftId: string): void {
  try {
    const ids = readDeliveredIds().filter((id) => id !== draftId);
    ids.push(draftId);
    window.sessionStorage.setItem(DELIVERED_STORAGE_KEY, JSON.stringify(ids.slice(-MAX_DELIVERED)));
  } catch {
    // Quota exceeded or storage disabled. Nothing to do; see the comment above.
  }
}

function enqueue(event: AssistantEvent): void {
  queue.push(event);
  if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
}

// Filtered by name so it doesn't matter whether the buffer also holds the applied/generated markers; those come
// from our own session state and counting them here would double-count.
function harvestCorrections(): { field: string; from: ProvenanceSource }[] {
  return drainTelemetry()
    .filter((event) => event.name === 'field_corrected' && event.field && event.from)
    .map((event) => ({ field: event.field as string, from: event.from as ProvenanceSource }));
}

/**
 * A draft was applied to the Generator's form. This is the denominator of the field-edit rate, so it's reported
 * from here rather than from the server's decision: an expired draft, disabled storage or a teacher who navigated
 * away all give a server-side `prefill` with no delivery. Applying a second draft closes out the first session.
 */
export function notePrefillDelivered(input: {
  draftId: string;
  actionId: string;
  requestId?: string;
  fieldCount: number;
  lowConfidenceCount: number;
}): void {
  if (!ASSISTANT_ENABLED) return;
  if (session && session.draftId === input.draftId) return; // already counted in this page life
  if (wasDelivered(input.draftId)) return; // already counted before a refresh

  closeOpenSession();

  session = {
    draftId: input.draftId,
    actionId: input.actionId,
    requestId: input.requestId ?? '',
    fieldCount: input.fieldCount,
    outcomeSent: false,
  };

  // Corrections still buffered belong to the previous session; start clean.
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

// Latched so a session is at most two rows: edit a field, tab away (edited), come back, press Generate would
// otherwise write three.
function noteOutcome(outcome: PrefillOutcome, harvested?: { field: string; from: ProvenanceSource }[]): void {
  if (!ASSISTANT_ENABLED) return;
  if (!session || session.outcomeSent) return;

  // Drains once per outcome; callers that already harvested pass their corrections in so they aren't lost.
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

// Reports `edited` only if the teacher corrected something. No corrections and no terminal action is an
// abandonment, which is reported by silence (no row) rather than an explicit "nothing happened" write.
function closeOpenSession(): void {
  if (!session || session.outcomeSent) return;

  const corrections = harvestCorrections();
  if (corrections.length === 0) return;
  noteOutcome('edited', corrections);
}

// One request in flight at a time; the rest waits for the next trigger.
export async function flush(): Promise<void> {
  if (!ASSISTANT_ENABLED || inFlight || queue.length === 0) return;

  inFlight = true;
  try {
    // Loop until empty: otherwise an outcome queued while the delivery flush is still in flight would wait
    // for an unrelated later event.
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      // Dropped on failure, never re-queued (see the header).
      await postAssistantEvents({ events: batch });
    }
  } catch {
    // postAssistantEvents shouldn't throw, but this is on the edit path so a rejected send just loses its batch.
  } finally {
    inFlight = false;
  }
}

// `visibilitychange` rather than `unload`, which often never fires on mobile Chrome. Still best-effort, which is
// why abandonment is derived from absence.
export function flushOnHide(): void {
  closeOpenSession();
  void flush();
}

// Test seam: fresh tab. Resets everything including the persisted delivered set; see `simulateReload` for a refresh.
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

// Test seam: hard refresh of the same tab. Memory state is gone but sessionStorage (the delivered record) survives.
export function simulateReload(): void {
  session = null;
  queue = [];
  inFlight = false;
}

// Test seam: the queued events, without sending them.
export function peekQueue(): AssistantEvent[] {
  return [...queue];
}
