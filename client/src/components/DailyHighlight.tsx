import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { WelcomeHighlight } from '../lib/welcome';

interface DailyHighlightProps {
  highlight: WelcomeHighlight;
}

// Subtle, clickable card under the welcome greeting (fact/thought of the day,
// or a special-day note — see lib/welcome.ts for the content rules). Opens a
// small detail dialog with the fuller, teacher-facing explanation. A plain
// <button> gets click + Enter/Space for free; only Escape/outside-click and
// focus return need to be wired up here, matching the app's other portalled
// dialogs (see AttachmentPreviewModal/ConfirmDialog).
export default function DailyHighlight({ highlight }: DailyHighlightProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="daily-highlight-card"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${highlight.eyebrow}: ${highlight.summary}. Show details.`}
      >
        <span className="daily-highlight-emoji" aria-hidden="true">{highlight.emoji}</span>
        <span className="daily-highlight-text">
          <span className="daily-highlight-eyebrow">{highlight.eyebrow}</span>
          <span className="daily-highlight-summary">{highlight.summary}</span>
        </span>
      </button>

      {open && createPortal(
        <div
          className="highlight-overlay"
          // Only a click on the backdrop itself closes — matches
          // AttachmentPreviewModal's convention below.
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="highlight-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="highlight-panel-head">
              <h2 className="highlight-panel-title" id={titleId}>{highlight.detailTitle}</h2>
              <button
                ref={closeRef}
                type="button"
                className="icon-btn highlight-panel-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="highlight-panel-body">
              {highlight.detailBody.split('\n\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
