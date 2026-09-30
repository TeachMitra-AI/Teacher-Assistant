// Copy and timing for the waiting state under a submitted prompt (components/RunStatus.tsx). Pure: the component owns the
// ticking and passes elapsed time in, so thresholds are testable. The message names no stage ("Thinking…", "Writing…"):
// /coach is one non-streaming request, so the client learns nothing between send and receive, and the only true fact is
// how long we've waited. For the same reason there's no percentage bar, only a skeleton.

const STILL_WORKING_MS = 10_000;
const TAKING_LONGER_MS = 25_000;

/** `0:07`, `1:03` — minutes only appear once there are any. */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// What to say while waiting. The first message is the one the app has always shown, so a fast answer looks unchanged.
export function waitingMessage(elapsedMs: number): string {
  if (elapsedMs >= TAKING_LONGER_MS) return 'This is taking longer than usual.';
  if (elapsedMs >= STILL_WORKING_MS) return 'Still working — a good answer takes a moment.';
  return 'Preparing practical advice for you…';
}
