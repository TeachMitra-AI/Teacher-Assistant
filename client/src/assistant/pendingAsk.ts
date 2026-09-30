// Completes a clarifying question entirely client-side: the client already holds the params the server resolved and the
// answer supplies the missing one, so there's no second network or model call. Safe because filling a slot can only move
// `ask` to `prefill`, values come from options the server offered, and the Generator re-coerces every param anyway.
// Separate from RouterProvider so the logic can be unit-tested.

import { normalizeUtterance } from './intentGate';
import type { AskPrompt, ResolvedAction } from './types';

// A clarifying question waiting for an answer. In memory only, since it's tied to a conversational moment.
// Cleared by answering, cancelling, submitting something else, a new chat or navigating away.
export interface PendingAskState {
  /** The server's `ask` decision, with the partial params it resolved. */
  action: ResolvedAction;
  /** What the teacher originally typed; the coach's input if this is cancelled. */
  utterance: string;
  /** Correlation id of the interpret call that asked, so answering by chip still joins back to it in telemetry. */
  requestId?: string;
}

// Longest reply still plausible as a slot value rather than a new request.
const MAX_FREE_TEXT_VALUE = 120;

/**
 * What the reply means for this question, or null if it isn't an answer.
 * With options ("Quiz or worksheet?") it must match one by label or value, so typing "worksheet" equals tapping the chip.
 * Without options ("What topic?") the reply is the value; otherwise a `topic` ask would dead-end, since "fractions" has
 * no imperative verb and would fail the intent gate.
 */
export function resolveAskReply(ask: AskPrompt | undefined, reply: string): string | null {
  if (!ask || typeof reply !== 'string') return null;
  const trimmed = reply.trim();
  if (!trimmed) return null;

  if (Array.isArray(ask.options) && ask.options.length > 0) {
    const normalized = normalizeUtterance(trimmed);
    const match = ask.options.find(
      (option) =>
        normalizeUtterance(option.value) === normalized ||
        normalizeUtterance(option.label) === normalized
    );
    return match ? match.value : null;
  }

  return trimmed.length <= MAX_FREE_TEXT_VALUE ? trimmed : null;
}

/**
 * Folds an answer into the action, producing the `prefill` the executor runs. The slot's provenance is `utterance`,
 * not `user`, so the whole prefill stays undoable as one unit ("Clear AI fields" skips `user` values).
 * Returns a new action; the pending one is never mutated.
 */
export function completeAsk(action: ResolvedAction, value: string): ResolvedAction {
  const slot = action.ask ? action.ask.slot : '';
  if (!slot) return { ...action, decision: 'prefill' };

  const completed: ResolvedAction = {
    ...action,
    decision: 'prefill',
    params: { ...action.params, [slot]: value },
    provenance: { ...action.provenance, [slot]: 'utterance' },
    missing: Array.isArray(action.missing) ? action.missing.filter((name) => name !== slot) : [],
  };
  // Drop the answered question so the composer doesn't re-render a prompt for a filled slot.
  delete completed.ask;
  return completed;
}

// Test seam: tests assert the bound rather than redeclare it.
export const ASK_MAX_FREE_TEXT_VALUE = MAX_FREE_TEXT_VALUE;
