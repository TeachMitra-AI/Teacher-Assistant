// Copy and timing for the waiting state shown under a submitted prompt while
// the coach is answering (components/RunStatus.tsx).
//
// Pure: no clock of its own, no DOM. The component owns the ticking and passes
// the elapsed time in, so every threshold below is testable without waiting for
// real seconds to pass.
//
// ─── WHY THE MESSAGE CANNOT NAME A STAGE ────────────────────────────────────
// An earlier sketch of this had the label move through "Thinking…" → "Writing
// your answer…". That would be invented: /coach is a single non-streaming
// request (the endpoint is Gemini's `:generateContent`), so the client learns
// nothing at all between sending and receiving. The only fact available here is
// how long we have been waiting, so the messages below say exactly that and
// nothing more. The same reasoning rules out a percentage bar — hence a
// skeleton, which claims only that content is coming.

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
 * What to say while waiting. The first message is the one this app has always
 * shown, so a fast answer looks exactly as it did before.
 */
export function waitingMessage(elapsedMs: number): string {
  if (elapsedMs >= TAKING_LONGER_MS) return 'This is taking longer than usual.';
  if (elapsedMs >= STILL_WORKING_MS) return 'Still working — a good answer takes a moment.';
  return 'Preparing practical advice for you…';
}
