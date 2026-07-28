// AI Action Router — clarifying-question completion (Phase 1, Milestone M6).
//
// Amendment CHANGE-3: answering a clarifying question is resolved ENTIRELY
// CLIENT-SIDE. The client already holds the full parameter set the server
// resolved; the answer supplies the one value that was missing. No second
// network call, no second model call, no second round of latency on a phone.
//
// ─── WHY THIS IS A SEPARATE MODULE ─────────────────────────────────────────
// It is the only interesting logic in the pendingAsk flow, and the client test
// runner covers pure logic only. Inside RouterProvider it would be logic that
// can only be exercised by hand.
//
// ─── WHY COMPLETING AN ASK IS SAFE ─────────────────────────────────────────
// Filling a slot can only move a decision from `ask` to `prefill`. It cannot
// reach `execute` — the executor downgrades that — and it cannot generate
// anything. The values come from options the SERVER offered, produced by the
// resolver from the registry's own vocabulary, so the client never invents one.
// And the Generator re-coerces every parameter through coercePrefillValues, so
// even a hand-crafted value cannot land in a typed field.

import { normalizeUtterance } from './intentGate';
import type { AskPrompt, ResolvedAction } from './types';

/**
 * A clarifying question waiting for an answer.
 *
 * Held in memory only, never in storage: it is tied to a conversational moment,
 * and a question that outlives the moment is worse than no question. It is
 * cleared by answering, cancelling, submitting anything else, starting a new
 * chat, or navigating away.
 */
export interface PendingAskState {
  /** The server's `ask` decision, complete with the partial params it resolved. */
  action: ResolvedAction;
  /** What the teacher originally typed — the coach's input if this is cancelled. */
  utterance: string;
}

/**
 * Longest reply still plausible as a slot VALUE rather than a new request.
 *
 * "Fractions and decimals" is a topic. Three sentences is a teacher who has
 * moved on, and should be treated as a fresh message rather than crammed into a
 * form field.
 */
const MAX_FREE_TEXT_VALUE = 120;

/**
 * What the teacher's reply means for this question, or null if it means nothing
 * usable here.
 *
 * Two shapes of question, both of which the registry can declare:
 *
 *   - WITH options ("Quiz or worksheet?"): the reply must match one of them, by
 *     label or by value. Anything else is not an answer to this question, so it
 *     is treated as a new message. Matching by label as well as value is what
 *     makes typing "worksheet" identical to tapping the Worksheet chip.
 *
 *   - WITHOUT options ("What topic should it cover?"): the reply IS the value.
 *     This is not an extension of the client-side rule but its completion —
 *     the server asked an open question, and the answer to an open question is
 *     open text. Without it a `topic` ask would dead-end: "fractions" carries no
 *     imperative verb, so re-classifying it would fail the intent gate and the
 *     teacher would get a coaching answer to a question they never asked.
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
 * Folds an answer into the action, producing the `prefill` the executor runs.
 *
 * Provenance for the answered slot is `utterance` rather than `user` (approved
 * decision D4). The teacher did say it — in a second breath, prompted, but said
 * it — and the whole prefill should stay undoable as one unit. Marking it `user`
 * would leave an unmarked value that "Clear AI fields" deliberately skips,
 * stranding it in the form after the teacher rejected everything around it.
 *
 * Returns a NEW action; the pending one is never mutated, so a cancelled or
 * superseded ask leaves nothing half-applied behind it.
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
  // The question has been answered; carrying it forward would let the composer
  // re-render a prompt for a slot that is now filled.
  delete completed.ask;
  return completed;
}

/** Test seam: the bound is policy, and the tests assert the policy rather than re-declaring it. */
export const ASK_MAX_FREE_TEXT_VALUE = MAX_FREE_TEXT_VALUE;
