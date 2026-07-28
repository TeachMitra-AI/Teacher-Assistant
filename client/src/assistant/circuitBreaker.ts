// AI Action Router — client circuit breaker (Phase 1, Milestone M6).
//
// Layer 6 of the six feature-flag layers, and the only one that operates without
// anyone deciding anything: when the router's endpoint is failing, stop asking
// it. A teacher whose backend is unreachable should wait zero milliseconds for
// the router before their message goes to the coach, not five seconds per turn.
//
// What trips it: transport-level failure only — a network error, a 429, a 5xx,
// or the client's own deadline. Notably NOT a passthrough: the server returning
// "this is not an action" is the endpoint working exactly as designed, and
// treating a working endpoint's most common answer as a fault would disable the
// feature within three coaching questions.
//
// State lives in memory, never in storage. A reload gives the router a fresh
// chance, which is the right default for a transient upstream problem — and it
// keeps this a runtime safety valve rather than a persisted setting nobody can
// see.
//
// This is a separate module rather than state inside RouterProvider (approved
// decision D7) because the client test runner covers pure logic only. A breaker
// buried in a React provider is a breaker whose window can only be verified by
// waiting sixty seconds by hand.

/**
 * Sixty seconds, matching the window the spec gives the client on a 429 (§7.3).
 *
 * Long enough that a failing backend is not re-probed on every keystroke-length
 * interaction, short enough that a teacher who waits out a restart gets the
 * feature back within a minute without reloading.
 */
const OPEN_MS = 60 * 1000;

export interface CircuitBreaker {
  /** True while router requests must be skipped. */
  isOpen: () => boolean;
  /** Records a transport failure and opens the circuit for the full window. */
  trip: () => void;
  /**
   * Closes immediately.
   *
   * Deliberately NOT called by "new chat": a backend that was unreachable ten
   * seconds ago is still unreachable, and letting a UI action re-probe it would
   * hand the teacher the five-second wait this breaker exists to remove. It is
   * here for tests and for a future sign-out, not for error handling.
   */
  reset: () => void;
}

/**
 * Builds a breaker.
 *
 * The clock is injected so the window is testable without waiting for it. The
 * default is the real clock, so no caller has to know this parameter exists.
 */
export function createCircuitBreaker(
  openMs: number = OPEN_MS,
  now: () => number = () => Date.now()
): CircuitBreaker {
  let openedUntil = 0;

  return {
    isOpen: () => now() < openedUntil,
    // Re-tripping extends the window from the latest failure rather than the
    // first. A backend that is still down after fifty seconds should not get a
    // fresh request ten seconds later.
    trip: () => {
      openedUntil = now() + openMs;
    },
    reset: () => {
      openedUntil = 0;
    },
  };
}

/** Test seam: the window is policy, and the tests assert the policy rather than re-declaring it. */
export const BREAKER_OPEN_MS = OPEN_MS;
