// AI Action Router — the ActionExecutor (Phase 1, Milestone M6).
//
// A DISPATCHER, NOT A DECISION-MAKER. It receives an action the server has
// already decided on, looks up a handler by id, and calls it. Everything it does
// beyond that is defensive.
//
// ─── THE REGISTRY-DRIVEN INVARIANT (binding) ───────────────────────────────
// This file contains NO action-specific branching, and must not acquire any.
// Adding an action requires one new handler file and one registration line in
// handlers/index.ts — and ZERO edits here. Every lookup below goes through the
// handler map or the domain map; there is no `if (actionId === …)` and no route
// string in this file.
//
// The test for a reviewer is mechanical: search this file for any action id or
// any path. Both must return nothing. If a new action ever forces a change here,
// the abstraction has failed and the correct response is to stop and fix the
// core, not to add a branch (spec §8.3).
//
// ─── WHY IT IS SO DEFENSIVE ────────────────────────────────────────────────
// The client is a PWA with service-worker caching, so a client running against a
// newer server is an ordinary state. Three things follow, and all three are
// implemented below rather than assumed away:
//
//   1. An unknown action id is ROUTINE. It must never throw — a throw here is a
//      blank screen (technical-debt item #14).
//   2. `decision: 'execute'` is defined in the contract and never emitted in
//      Phase 1. It is downgraded to `prefill`, so a future server rollout cannot
//      surprise an old client into generating without teacher review.
//   3. An effect above `draft` is refused outright, whatever the decision says.
//
// No path here calls the network, generates, or saves anything.

import { resolveDomainHome, resolveHandler } from './handlers';
import type { HandlerContext } from './handlers/types';
import type { ActionEffect, ResolvedAction } from './types';

/**
 * What happened, from the composer's point of view.
 *
 * `passthrough` means "I did not take the teacher anywhere — submit their
 * message to the coach as usual". The executor never calls the coach itself;
 * deciding what a non-navigation means belongs to the caller.
 */
export type ExecutionOutcome = 'navigated' | 'passthrough';

export interface ExecutorContext extends HandlerContext {
  /**
   * Which module owns an id this build has no handler for. Injected (rather than
   * imported) so the executor depends on a question, not on the catalog module —
   * and so the fallback is testable without storage.
   */
  domainOf?: (actionId: string) => string | null;
}

/**
 * Effect classes this client will act on, at any confidence, ever.
 *
 * The registry declares effect and the server policy already caps decisions by
 * it; this is the same ceiling asserted independently on the client. It is not
 * redundancy for its own sake — it is the check that still holds if a future
 * server is misconfigured, and it is keyed on the effect VOCABULARY, never on
 * which actions happen to exist.
 */
const NAVIGABLE_EFFECTS: ReadonlySet<ActionEffect> = new Set<ActionEffect>(['read', 'draft']);

/**
 * Decisions that mean "take the teacher there".
 *
 * `ask` is absent deliberately: a clarifying question is answered in the
 * composer and only reaches the executor once it has been completed into a
 * `prefill`. An `ask` arriving here would be a caller bug, and the safe reading
 * of a caller bug is to do nothing.
 */
const ACTIONABLE_DECISIONS = new Set(['prefill']);

/** Metadata-only warning. Never pass utterance text or a slot value through here (G11). */
function warn(event: string, meta: Record<string, unknown>): void {
  console.warn(`[assistant] ${event}`, meta);
}

/** Does this look like something the executor can reason about at all? */
function isDispatchable(action: unknown): action is ResolvedAction {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return false;
  const raw = action as Record<string, unknown>;
  return typeof raw.actionId === 'string' && raw.actionId !== '';
}

/**
 * Run one already-decided action.
 *
 * Total catch around the handler: a broken handler must cost a routing
 * opportunity, never the composer. The teacher gets their coaching answer and
 * never learns that anything went wrong, which is the whole failure posture of
 * this feature.
 */
export function executeAction(action: ResolvedAction, context: ExecutorContext): ExecutionOutcome {
  if (!isDispatchable(action)) {
    warn('execute_malformed_action', {});
    return 'passthrough';
  }

  const { actionId, effect } = action;
  let { decision } = action;

  // Contract-defensive downgrade. Logged because a Phase 1 server emitting this
  // would be a genuine incident worth noticing, even though it costs the teacher
  // nothing.
  if (decision === 'execute') {
    warn('execute_downgraded_to_prefill', { actionId });
    decision = 'prefill';
  }

  if (!ACTIONABLE_DECISIONS.has(decision)) {
    warn('execute_unactionable_decision', { actionId, decision });
    return 'passthrough';
  }

  if (!NAVIGABLE_EFFECTS.has(effect)) {
    warn('execute_effect_above_ceiling', { actionId, effect });
    return 'passthrough';
  }

  const handler = resolveHandler(actionId);

  // Unknown id — the routine stale-client case, not an error. The catalog knows
  // the domain even when this bundle does not know the action, so the teacher
  // reaches the right module rather than nowhere.
  if (!handler) {
    const home = resolveDomainHome(context.domainOf ? context.domainOf(actionId) : null);
    if (!home) {
      warn('execute_unknown_action', { actionId });
      return 'passthrough';
    }
    warn('execute_unknown_action_domain_fallback', { actionId });
    try {
      context.navigate(home);
      return 'navigated';
    } catch {
      return 'passthrough';
    }
  }

  try {
    handler(action, context);
    return 'navigated';
  } catch {
    // Deliberately no detail in the log line: whatever a handler throws may
    // reference a parameter value, and this module may not put one anywhere.
    warn('execute_handler_failed', { actionId });
    return 'passthrough';
  }
}
