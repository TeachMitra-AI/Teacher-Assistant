// Dispatches an action the server already decided on to its handler. No action-specific branching lives here: adding
// an action means a new handler plus one registration in handlers/index.ts, and no edit to this file.
// Defensive because a cached PWA client can run against a newer server: an unknown action id is routine and must
// never throw, `execute` is downgraded to `prefill`, and effects above `draft` are refused. Never touches the network.

import { resolveDomainHome, resolveHandler } from './handlers';
import type { HandlerContext } from './handlers/types';
import type { ActionEffect, ResolvedAction } from './types';

// `passthrough` means the teacher wasn't taken anywhere, so the caller submits the message to the coach.
export type ExecutionOutcome = 'navigated' | 'passthrough';

export interface ExecutorContext extends HandlerContext {
  /** Which module owns an id this build has no handler for. Injected so the fallback is testable without storage. */
  domainOf?: (actionId: string) => string | null;
}

// Effects the client will act on at any confidence. The server already caps decisions by effect; this repeats the
// ceiling on the client so it holds even if the server is misconfigured.
const NAVIGABLE_EFFECTS: ReadonlySet<ActionEffect> = new Set<ActionEffect>(['read', 'draft']);

// `ask` is absent on purpose: a clarifying question is completed into a `prefill` before it reaches the executor.
const ACTIONABLE_DECISIONS = new Set(['prefill']);

// Metadata only: never log utterance text or a slot value.
function warn(event: string, meta: Record<string, unknown>): void {
  console.warn(`[assistant] ${event}`, meta);
}

function isDispatchable(action: unknown): action is ResolvedAction {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return false;
  const raw = action as Record<string, unknown>;
  return typeof raw.actionId === 'string' && raw.actionId !== '';
}

// A broken handler costs a routing opportunity, never the composer; the teacher just gets their coaching answer.
export function executeAction(action: ResolvedAction, context: ExecutorContext): ExecutionOutcome {
  if (!isDispatchable(action)) {
    warn('execute_malformed_action', {});
    return 'passthrough';
  }

  const { actionId, effect } = action;
  let { decision } = action;

  // `execute` isn't emitted yet; log it since it would be a real incident, but downgrade so nothing runs unreviewed.
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

  // Unknown id is the normal stale-client case. Fall back to the catalog's domain so the teacher still lands
  // in the right module.
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
    // No detail logged: a handler's error may reference a parameter value.
    warn('execute_handler_failed', { actionId });
    return 'passthrough';
  }
}
