// Handler contract. Types only; a leaf file so the map, the handlers and the executor share one interface without an
// import cycle.

import type { ResolvedAction } from '../types';

// Everything a handler may know. Deliberately tiny: it navigates and at most writes a draft, with no access to memory,
// the breaker, the cache, the catalog or React.
export interface HandlerContext {
  /** The app's router push; injected so handlers stay unit-testable. */
  navigate: (to: string) => void;
  /** For the Generator's banner only; stored in the draft, never sent to a URL, log or the server. */
  utterance: string;
  /** Correlation id stored with the draft so its telemetry joins back to the decision. */
  requestId?: string;
}

// One action's execution. If a handler can't do its job it navigates to a sensible fallback; if it throws, the
// executor catches and the composer falls back to the coach.
export type ActionHandler = (action: ResolvedAction, context: HandlerContext) => void;
