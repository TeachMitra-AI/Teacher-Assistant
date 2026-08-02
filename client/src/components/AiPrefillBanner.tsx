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

// Shown on the Generator when the AI Action Router has pre-filled the form
// (milestone M3). Presentational only — it reads no store, fires no telemetry,
// and knows nothing about drafts or navigation. The page owns all of that.
//
// It earns its place by making the routing VISIBLE. A form that silently fills
// itself is the failure mode described in the architecture document as "an
// invisible product": teachers cannot tell which phrasings work, so they try
// twice, fail once, and go back to clicking. Showing the utterance alongside
// what it produced is how the mapping becomes learnable, and the undo is how a
// wrong guess costs one tap instead of a teacher's confidence.
//
// Accessibility (CHANGE-12) follows the conventions already used across this
// codebase rather than inventing new ones:
//   - aria-live="polite" because this announces something that happened WITHOUT
//     the teacher asking — a navigation they did not click. "polite" waits for a
//     pause rather than interrupting whatever is being read.
//   - The undo is a real <button> with a descriptive label, not an icon alone.
//   - The low-confidence notice is TEXT, never colour alone, matching the rule
//     that provenance markers carry an accessible label.
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
