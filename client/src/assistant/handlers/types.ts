// AI Action Router — the handler contract (Phase 1, Milestone M6).
//
// Types only, so this file compiles away entirely. It exists to break what would
// otherwise be an import cycle: the handler map imports each handler, each
// handler needs the shape it is called with, and the executor needs both. A leaf
// that all three import has neither the cycle nor a duplicated interface — the
// same reasoning that produced server/src/lib/resourceFields.js at M1.

import type { ResolvedAction } from '../types';

/**
 * Everything a handler is allowed to know about the world.
 *
 * Deliberately tiny. A handler navigates and, at most, writes a draft. It has no
 * access to session memory, the breaker, the cache, the catalog or React — and
 * it is called with the already-decided action, so it has nothing to decide.
 */
export interface HandlerContext {
  /** The app's router push. Injected so handlers stay unit-testable and free of React. */
  navigate: (to: string) => void;
  /**
   * What the teacher typed, for the Generator's banner ("Filled in from: …").
   * Display only: it is stored in the draft, which never leaves this tab, and it
   * must never reach a URL, a log, or the server (G11, G12).
   */
  utterance: string;
  /**
   * The interpret response's correlation id (M8), stored with the draft so this
   * prefill's telemetry can be joined to the decision that produced it.
   *
   * Opaque and server-minted. It is the exact opposite of `utterance` above:
   * that one must never leave the tab, this one exists to go back — which is why
   * they are documented together rather than in separate places where the
   * distinction could be missed.
   */
  requestId?: string;
}

/**
 * One action's execution.
 *
 * Returns nothing: reaching the end means the teacher has been taken somewhere.
 * A handler that cannot do its job navigates to a sensible fallback rather than
 * reporting failure — and if it throws, the executor catches and the composer
 * falls back to the coach.
 */
export type ActionHandler = (action: ResolvedAction, context: HandlerContext) => void;
