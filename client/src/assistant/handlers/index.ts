// The handler map, and the only place an action is registered: one handler file plus one line per map below. The
// executor isn't edited and has no knowledge of any action. An explicit map rather than filesystem discovery, so the set
// of things the client will act on is visible in one diff.

import { generateAssessmentHandler } from './generateAssessment';
import { openGeneratorHandler } from './openGenerator';
import { GENERATOR_ROUTE } from './routes';
import type { ActionHandler } from './types';

// actionId → handler.
const HANDLERS: Record<string, ActionHandler> = {
  generate_assessment: generateAssessmentHandler,
  open_generator: openGeneratorHandler,
};

// domain → module home. The unknown-id fallback: if a newer server sends an action this bundle has no handler for, the
// catalog still gives its domain, so the teacher lands in the right module. One entry per module, so new actions in an
// existing domain degrade gracefully without a client release.
const DOMAIN_HOMES: Record<string, string> = {
  generator: GENERATOR_ROUTE,
};

export function resolveHandler(actionId: string): ActionHandler | null {
  if (!actionId) return null;
  // Own-property check so "constructor" or "toString" don't resolve to something inherited.
  return Object.prototype.hasOwnProperty.call(HANDLERS, actionId) ? HANDLERS[actionId] : null;
}

export function resolveDomainHome(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return Object.prototype.hasOwnProperty.call(DOMAIN_HOMES, domain) ? DOMAIN_HOMES[domain] : null;
}

// Test seams: the registered sets are the contract.
export const REGISTERED_ACTION_IDS = Object.keys(HANDLERS);
export const REGISTERED_DOMAINS = Object.keys(DOMAIN_HOMES);
