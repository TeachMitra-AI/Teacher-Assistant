import { useEffect, useState } from 'react';
import { formatElapsed, waitingMessage } from '../lib/runStatus';

// The waiting state under a submitted prompt, replacing what used to be one
// unchanging line of text.
//
// It exists because a slow turn here is genuinely slow — the server retries
// rate-limited calls and can run continuations — and a frozen "Preparing
// practical advice for you…" reads as a hang. A teacher who concludes it is
// stuck sends the question again, which costs a second model call out of a
// budget that is already the tightest thing in this app.
//
// Three shimmering lines rather than a progress bar, and no percentage
// anywhere: /coach is a single non-streaming request, so the client cannot
// know how far along it is. A skeleton claims only that content is coming —
// which is true — and it reserves roughly the space the answer will occupy, so
// the thread does not jump when the response lands.
//
// No spinner: the shimmer IS the activity indicator, and two elements saying
// the same thing is one too many.
//
// A LEAF ON PURPOSE. The timer re-renders once a second; keeping it in its own
// component means that re-render touches these few characters instead of the
// whole thread.

interface RunStatusProps {
  /** Date.now() at submit. */
  startedAt: number;
}

export default function RunStatus({ startedAt }: RunStatusProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    // Re-read the clock rather than accumulating: a backgrounded tab throttles
    // timers, and a counter that adds 1000 per tick would drift behind the
    // real wait exactly when the wait is longest.
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="run-status">
      {/* Decorative: it stands in for text that does not exist yet, so there is
          nothing here for a screen reader to read. */}
      <div className="run-skeleton" aria-hidden="true">
        <span className="sk-line" />
        <span className="sk-line" />
        <span className="sk-line" />
      </div>

      <div className="run-status-row">
        {/* Only the MESSAGE is a live region. Putting the clock in one would
            make a screen reader announce the time every single second, which is
            worse than saying nothing — so the timer is hidden from assistive
            tech and the message (which changes twice in a long wait) carries
            the news. */}
        <span className="run-status-message" role="status" aria-live="polite">
          {waitingMessage(elapsedMs)}
        </span>
        <span className="run-status-time" aria-hidden="true">{formatElapsed(elapsedMs)}</span>
      </div>
    </div>
  );
}
