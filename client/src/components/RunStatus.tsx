import { useEffect, useState } from 'react';
import { formatElapsed, waitingMessage } from '../lib/runStatus';

// The waiting state under a submitted prompt. A slow turn is genuinely slow (the server retries rate-limited calls and can
// run continuations), and a frozen line reads as a hang, so a teacher resends and spends a second call from the tightest budget.
// Three shimmering lines rather than a progress bar or percentage: /coach is one non-streaming request, so the client can't
// know progress. The skeleton claims only that content is coming and reserves roughly the answer's space so the thread doesn't jump.
// No spinner; the shimmer is the activity indicator.
// A leaf on purpose: the timer re-renders every second, and this keeps that off the whole thread.

interface RunStatusProps {
  /** Date.now() at submit. */
  startedAt: number;
}

export default function RunStatus({ startedAt }: RunStatusProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    // Re-read the clock rather than accumulating: a backgrounded tab throttles timers, and a counter would drift behind exactly when the wait is longest.
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="run-status">
      {/* Decorative: it stands in for text that doesn't exist yet, so a screen reader has nothing to read. */}
      <div className="run-skeleton" aria-hidden="true">
        <span className="sk-line" />
        <span className="sk-line" />
        <span className="sk-line" />
      </div>

      <div className="run-status-row">
        {/* Only the message is a live region: a live clock would be announced every second. The timer is hidden from
            assistive tech and the message (which changes twice in a long wait) carries the news. */}
        <span className="run-status-message" role="status" aria-live="polite">
          {waitingMessage(elapsedMs)}
        </span>
        <span className="run-status-time" aria-hidden="true">{formatElapsed(elapsedMs)}</span>
      </div>
    </div>
  );
}
