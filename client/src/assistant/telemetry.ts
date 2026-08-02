// AI Action Router — correction signal (Phase 1, Milestone M3).
//
// This module exists to answer one question: IS THE ROUTER ANY GOOD?
//
// Model confidence cannot answer it. A router that reports "high confidence" on
// every utterance while teachers rewrite half the fields is a bad router that
// looks excellent in its own logs. The honest metric is the FIELD-EDIT RATE —
// the share of prefilled fields a teacher changes before generating — and it is
// the launch gate (target < 20%, and < 15% sustained before auto-generation is
// even considered). Hence this ships in M3, with the prefill it measures, not
// later as polish: retrofitting it means the first weeks of real usage produce
// no signal at all.
//
// ─── THE PRIVACY RULE, ENFORCED BY THE TYPES ───────────────────────────────
// Events carry a field NAME and a provenance SOURCE. They never carry a field
// VALUE, the utterance, or anything else the teacher wrote. That is guardrail
// G11, and the "we'll log the text temporarily to debug this" shortcut is
// technical-debt item #6 precisely because "temporarily" becomes permanent.
//
// The rule is structural rather than a convention: no function below accepts a
// parameter that could hold teacher-authored content. There is nowhere to put a
// value even by accident.
//
// ─── TRANSPORT ─────────────────────────────────────────────────────────────
// M3 buffers in memory. M8 adds the transport and the low-volume Event rows
// (CHANGE-6: structured logs for decisions, database rows only for prefill
// delivery and outcome, because Event is a rare-incident table and one row per
// interpret would put a sustained write stream on single-writer SQLite).
// Buffering now means the call sites are correct and reviewed before any
// transport exists to get them wrong.

import type { ProvenanceSource } from './types';

/**
 * What happened. Deliberately a small closed set — an open string would invite
 * a future caller to describe an event in free text, which is how content
 * eventually leaks into telemetry.
 */
export type AssistantTelemetryEventName =
  /** A draft was applied to the Generator. The denominator of the field-edit rate. */
  | 'prefill_applied'
  /** The teacher changed one AI-filled field. The numerator. */
  | 'field_corrected'
  /** The teacher cleared every AI field at once — a high-signal indicator that a routing was flatly wrong. */
  | 'undo_all'
  /**
   * The teacher pressed Generate with AI-filled fields present (M8).
   *
   * Recorded by an OBSERVER of the Generator's own state, never from inside
   * `handleGenerate` — that function is a protected area, and the spec is
   * explicit that router concepts appearing inside it mean the integration has
   * overreached. Watching `content` become non-null while AI provenance is
   * present establishes the same fact from outside.
   */
  | 'prefill_generated';

export interface AssistantTelemetryEvent {
  name: AssistantTelemetryEventName;
  actionId: string;
  /** Which field was corrected. A name from the registry's slot list — never its contents. */
  field?: string;
  /** What the corrected field's value had been attributed to, which is the diagnostic half of the signal. */
  from?: ProvenanceSource;
  /** Counts only. */
  fieldCount?: number;
  lowConfidenceCount?: number;
  at: number;
}

/**
 * Bounded so a long session cannot grow it without limit on a low-end device.
 * Oldest events are dropped first; losing an old correction event is immaterial
 * next to holding memory on a phone.
 */
const MAX_BUFFERED = 50;

let buffer: AssistantTelemetryEvent[] = [];

/** Never throws. Telemetry failing must never affect what the teacher is doing. */
function emit(event: AssistantTelemetryEvent): void {
  try {
    buffer.push(event);
    if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
  } catch {
    // Unreachable in practice, but this module sits on a teacher's edit path.
    // Swallowing here is the whole point: no measurement is worth a broken form.
  }
}

/** A draft was applied. Records shape only — how many fields, how many uncertain. */
export function recordPrefillApplied(actionId: string, fieldCount: number, lowConfidenceCount: number): void {
  emit({ name: 'prefill_applied', actionId, fieldCount, lowConfidenceCount, at: Date.now() });
}

/**
 * The teacher edited a field that the router had filled.
 *
 * `from` is what makes this diagnostic rather than merely damning: corrections
 * concentrated in `utterance`-sourced fields mean the classifier is misreading
 * teachers, while corrections concentrated in `profile` defaults mean the
 * profile is stale. Those call for opposite fixes.
 */
export function recordFieldCorrection(actionId: string, field: string, from: ProvenanceSource): void {
  emit({ name: 'field_corrected', actionId, field, from, at: Date.now() });
}

/** The teacher pressed "Clear AI fields". */
export function recordUndoAll(actionId: string, fieldCount: number): void {
  emit({ name: 'undo_all', actionId, fieldCount, at: Date.now() });
}

/**
 * The teacher generated with AI-filled fields present (M8) — the outcome that
 * says the routing did its job.
 *
 * Carries no counts: the transport already holds the delivered field count for
 * this session, and re-reporting it here would create a second number that can
 * disagree with the first.
 */
export function recordGenerated(actionId: string): void {
  emit({ name: 'prefill_generated', actionId, at: Date.now() });
}

/**
 * Returns the buffered events and empties the buffer.
 *
 * The seam M8 will attach a transport to, and the seam the tests read. Draining
 * rather than exposing the array keeps ownership unambiguous — there is exactly
 * one consumer of any given event.
 */
export function drainTelemetry(): AssistantTelemetryEvent[] {
  const drained = buffer;
  buffer = [];
  return drained;
}
