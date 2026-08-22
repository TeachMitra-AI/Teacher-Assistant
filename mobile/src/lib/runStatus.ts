// Ported verbatim from client/src/lib/runStatus.ts (docs/mobile-app-plan.md
// §23: "port RunStatus.tsx's loading-state copy"). Pure, no clock of its own
// — see components/coach/RunStatus.tsx for the ticking wrapper.
//
// The message cannot name a processing "stage": POST /coach is a single
// non-streaming request, so the client learns nothing between sending and
// receiving except how long it has waited. Same reasoning rules out a
// percentage/progress bar.

const STILL_WORKING_MS = 10_000;
const TAKING_LONGER_MS = 25_000;

/** `0:07`, `1:03` — minutes only appear once there are any. */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * What to say while waiting. The first message is the one this app has
 * always shown, so a fast answer looks exactly as it did before.
 */
export function waitingMessage(elapsedMs: number): string {
  if (elapsedMs >= TAKING_LONGER_MS) return 'This is taking longer than usual.';
  if (elapsedMs >= STILL_WORKING_MS) return 'Still working — a good answer takes a moment.';
  return 'Preparing practical advice for you…';
}
