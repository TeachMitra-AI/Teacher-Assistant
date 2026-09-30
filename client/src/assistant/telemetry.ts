// Local correction signal for the router. The metric that says whether it's any good is the field-edit rate (share of
// prefilled fields a teacher changes before generating), not model confidence, so this ships with the prefill it
// measures. Events carry a field name and a provenance source, never a value or the utterance, and no function here
// accepts anything that could hold teacher-authored content. Buffered in memory; telemetryTransport.ts sends the
// low-volume subset to the server.

import type { ProvenanceSource } from './types';

// A small closed set, so a caller can't describe an event in free text and leak content.
export type AssistantTelemetryEventName =
  /** A draft was applied to the Generator. The denominator of the field-edit rate. */
  | 'prefill_applied'
  /** The teacher changed one AI-filled field. The numerator. */
  | 'field_corrected'
  /** The teacher cleared every AI field at once — a high-signal indicator that a routing was flatly wrong. */
  | 'undo_all'
  /** The teacher pressed Generate with AI-filled fields present. Recorded by an observer of the Generator's state. */
  | 'prefill_generated';

export interface AssistantTelemetryEvent {
  name: AssistantTelemetryEventName;
  actionId: string;
  /** Which field was corrected; a slot name, never its contents. */
  field?: string;
  /** What the corrected value had been attributed to. */
  from?: ProvenanceSource;
  fieldCount?: number;
  lowConfidenceCount?: number;
  at: number;
}

// Bounded for low-end devices; oldest dropped first.
const MAX_BUFFERED = 50;

let buffer: AssistantTelemetryEvent[] = [];

function emit(event: AssistantTelemetryEvent): void {
  try {
    buffer.push(event);
    if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
  } catch {
    // Telemetry must never break a teacher's edit path.
  }
}

export function recordPrefillApplied(actionId: string, fieldCount: number, lowConfidenceCount: number): void {
  emit({ name: 'prefill_applied', actionId, fieldCount, lowConfidenceCount, at: Date.now() });
}

// `from` makes corrections diagnostic: many in `utterance` fields mean the classifier misreads teachers, many in
// `profile` defaults mean the profile is stale.
export function recordFieldCorrection(actionId: string, field: string, from: ProvenanceSource): void {
  emit({ name: 'field_corrected', actionId, field, from, at: Date.now() });
}

export function recordUndoAll(actionId: string, fieldCount: number): void {
  emit({ name: 'undo_all', actionId, fieldCount, at: Date.now() });
}

// No counts: the transport already holds the delivered field count, and a second number could disagree with it.
export function recordGenerated(actionId: string): void {
  emit({ name: 'prefill_generated', actionId, at: Date.now() });
}

// Returns the buffered events and empties it, so each event has exactly one consumer.
export function drainTelemetry(): AssistantTelemetryEvent[] {
  const drained = buffer;
  buffer = [];
  return drained;
}
