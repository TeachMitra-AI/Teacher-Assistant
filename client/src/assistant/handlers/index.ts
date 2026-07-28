// AI Action Router — the handler map (Phase 1, Milestone M6).
//
// THE REGISTRATION POINT, AND THE ONLY ONE. Adding an action to the client is
// one new handler file and one line in each map below. The executor is not
// edited, and must not be: it dispatches through these lookups and contains no
// knowledge of any particular action.
//
// That is the client half of the four-artifact rule (spec §8.3) — a descriptor,
// a schema, a client handler, and eval cases. If a future action forces a change
// to ActionExecutor.ts, the abstraction has failed and the right response is to
// stop and fix the core rather than to add a branch.
//
// An explicit map, never filesystem discovery: the live set of things the client
// will act on must be visible in one file, in a diff, in a review — the same
// rule the server registry follows.

import { generateAssessmentHandler } from './generateAssessment';
import { openGeneratorHandler } from './openGenerator';
import { GENERATOR_ROUTE } from './routes';
import type { ActionHandler } from './types';

/** actionId → what to do about it. One line per action. */
const HANDLERS: Record<string, ActionHandler> = {
  generate_assessment: generateAssessmentHandler,
  open_generator: openGeneratorHandler,
};

/**
 * domain → where that module lives.
 *
 * The unknown-id fallback, and the reason the catalog endpoint has a consumer on
 * the client at all. A server that rolls out `duplicate_assessment` to a client
 * whose bundle predates it finds no handler above — but the catalog says the
 * action's domain is `generator`, so the teacher lands on the Generator rather
 * than nowhere. One entry per module, not per action, so a new action in an
 * existing domain degrades gracefully with no client release whatsoever.
 */
const DOMAIN_HOMES: Record<string, string> = {
  generator: GENERATOR_ROUTE,
};

/** The handler for an action id, or null when this build has never heard of it. */
export function resolveHandler(actionId: string): ActionHandler | null {
  if (!actionId) return null;
  // Own-property check: an action id of "constructor" or "toString" must resolve
  // to nothing rather than to something inherited from Object.prototype.
  return Object.prototype.hasOwnProperty.call(HANDLERS, actionId) ? HANDLERS[actionId] : null;
}

/** The home route for a domain, or null when this build does not know the domain either. */
export function resolveDomainHome(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return Object.prototype.hasOwnProperty.call(DOMAIN_HOMES, domain) ? DOMAIN_HOMES[domain] : null;
}

/** Test seams: the registered sets are the contract, and the tests assert them rather than re-declaring them. */
export const REGISTERED_ACTION_IDS = Object.keys(HANDLERS);
export const REGISTERED_DOMAINS = Object.keys(DOMAIN_HOMES);
