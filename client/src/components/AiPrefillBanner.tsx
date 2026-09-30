import { Sparkles, RotateCcw, X } from 'lucide-react';

interface AiPrefillBannerProps {
  /** Filled-in field count, so the teacher can see the scale of what was assumed. */
  fieldCount: number;
  /** How many values are prefilled but uncertain — an ambiguous grade, typically. */
  lowConfidenceCount: number;
  /** What the teacher typed, shown so the mapping from phrasing to fields is learnable. Display only. */
  utterance?: string;
  /** Resets every AI-filled field the teacher has not already edited. */
  onUndo: () => void;
  /** Hides the banner and keeps the values. */
  onDismiss: () => void;
}

// Shown on the Generator when the AI Action Router has pre-filled the form. Presentational only: it reads no store, fires no
// telemetry and knows nothing about drafts or navigation; the page owns all that.
// It makes the routing visible. A form that fills itself silently is an "invisible product": teachers can't tell which
// phrasings work. Showing the utterance beside what it produced makes the mapping learnable, and the undo makes a wrong
// guess cost one tap.
// Accessibility: aria-live="polite" because this announces something the teacher didn't ask for, waiting for a pause; the
// undo is a real <button> with a descriptive label; and the low-confidence notice is text, never colour alone.
export default function AiPrefillBanner({
  fieldCount,
  lowConfidenceCount,
  utterance,
  onUndo,
  onDismiss,
}: AiPrefillBannerProps) {
  return (
    <div className="ai-banner" role="status" aria-live="polite">
      <span className="ai-banner-icon" aria-hidden="true">
        <Sparkles size={16} strokeWidth={2} />
      </span>

      <div className="ai-banner-body">
        <p className="ai-banner-title">
          {fieldCount === 1 ? '1 field was filled in for you' : `${fieldCount} fields were filled in for you`}
          {lowConfidenceCount > 0 && (
            <span className="ai-banner-uncertain"> · {lowConfidenceCount} needs checking</span>
          )}
        </p>
        {utterance && (
          <p className="ai-banner-source">
            From: <span className="ai-banner-utterance">“{utterance}”</span>
          </p>
        )}
        <p className="ai-banner-hint">Review the form and change anything that is not right, then generate.</p>
      </div>

      <div className="ai-banner-actions">
        <button type="button" className="ai-banner-undo" onClick={onUndo}>
          <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
          Clear AI fields
        </button>
        <button
          type="button"
          className="onboarding-dismiss ai-banner-close"
          onClick={onDismiss}
          aria-label="Dismiss this message and keep the filled-in values"
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
