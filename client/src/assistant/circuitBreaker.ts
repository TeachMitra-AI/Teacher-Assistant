// Stops asking the router endpoint for a minute after transport-level failures (network error, 429, 5xx, deadline),
// so a broken backend costs the teacher no wait before the coach. A passthrough does not trip it: that's the endpoint
// working as designed. State is in memory only, so a reload gets a fresh chance. Separate from RouterProvider so the
// window can be unit-tested without React.

// Long enough not to re-probe a failing backend on every interaction, short enough that a restart recovers in a minute.
const OPEN_MS = 60 * 1000;

export interface CircuitBreaker {
  /** True while router requests must be skipped. */
  isOpen: () => boolean;
  /** Records a transport failure and opens the circuit for the full window. */
  trip: () => void;
  /**
   * Closes immediately. Not called by "new chat": a backend that failed ten seconds ago is still down, and re-probing
   * would bring back the wait this breaker removes. For tests and a future sign-out.
   */
  reset: () => void;
}

// The clock is injectable so tests don't have to wait out the window.
export function createCircuitBreaker(
  openMs: number = OPEN_MS,
  now: () => number = () => Date.now()
): CircuitBreaker {
  let openedUntil = 0;

  return {
    isOpen: () => now() < openedUntil,
    // Re-tripping extends the window from the latest failure.
    trip: () => {
      openedUntil = now() + openMs;
    },
    reset: () => {
      openedUntil = 0;
    },
  };
}

// Test seam: tests assert the window rather than redeclare it.
export const BREAKER_OPEN_MS = OPEN_MS;
