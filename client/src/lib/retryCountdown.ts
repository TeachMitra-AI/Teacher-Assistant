// Copy and formatting for the "every Gemini API key is exhausted" state
// (ApiError.retryAt — see api.ts and hooks/useRetryCountdown.ts). Pure: no
// clock of its own, mirroring lib/runStatus.ts's separation between the
// ticking component/hook and the deterministic-to-test formatting it calls.

/** `2h 14m`, `45m`, `38s` — the two biggest non-zero units, floored. */
export function formatRetryWait(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** One shared message, used everywhere a "back in X" notice is shown. */
export function retryMessage(remainingMs: number): string {
  return `AI usage limit reached. You can try again in ${formatRetryWait(remainingMs)}.`;
}
