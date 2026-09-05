import { useEffect, useState } from 'react';

// Drives the "every Gemini API key is exhausted, back in X" UI (see
// ApiError.retryAt in api.ts and lib/retryCountdown.ts for the wording).
// Same drift-safe ticking pattern as components/RunStatus.tsx: re-read the
// clock each tick rather than accumulating, so a backgrounded tab doesn't
// leave `ready` stuck false past the real deadline.

/**
 * @param retryAt epoch ms at which the soonest key recovers, or null/undefined
 *   when there is no active cooldown.
 */
export function useRetryCountdown(retryAt: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (retryAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  const remainingMs = retryAt == null ? 0 : Math.max(0, retryAt - now);
  const ready = retryAt == null || remainingMs <= 0;

  return { remainingMs, ready };
}
