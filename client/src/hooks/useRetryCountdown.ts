import { useEffect, useState } from 'react';

// Drives the "every Gemini API key is exhausted, back in X" UI (ApiError.retryAt in api.ts; wording in lib/retryCountdown.ts).
// Same drift-safe ticking as components/RunStatus.tsx: it re-reads the clock each tick, so a backgrounded tab can't leave
// `ready` stuck false past the deadline.

/** @param retryAt epoch ms at which the soonest key recovers, or null/undefined when there's no active cooldown. */
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
