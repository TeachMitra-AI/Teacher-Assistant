import { useId } from 'react';
import { HelpCircle, X } from 'lucide-react';
import type { AskOption } from '../assistant/types';

interface AiClarifyPromptProps {
  /** The server's question, e.g. "Quiz or worksheet?". Never composed here. */
  question: string;
  /** Chips. Empty for an open question, where the teacher types the answer instead. */
  options?: AskOption[];
  /** A chip was tapped. Resolved entirely on the client — no request is made. */
  onChoose: (value: string) => void;
  /** Dismiss. The original message still gets a coaching answer. */
  onCancel: () => void;
}

// Shown above the composer when the router understood the request but is one required value short. Presentational only: no
// state, requests, or knowledge of actions, drafts or navigation.
// It follows a decision-policy rule: more missing information means fewer questions. One gap is worth a single tap; two or
// more and the teacher should see the whole prefilled form, a better disambiguation surface than a five-turn interrogation
// on a phone. So it renders only one question with one answer.
// Accessibility: options are a labelled group tied to the question via aria-labelledby, so a screen reader announces the
// question first; aria-live="polite" since the question appears unasked; Cancel is a real button with a descriptive label.
export default function AiClarifyPrompt({ question, options, onChoose, onCancel }: AiClarifyPromptProps) {
  const questionId = useId();
  const hasOptions = Array.isArray(options) && options.length > 0;

  return (
    <div className="ai-clarify" role="status" aria-live="polite">
      <span className="ai-clarify-icon" aria-hidden="true">
        <HelpCircle size={16} strokeWidth={2} />
      </span>

      <div className="ai-clarify-body">
        <p className="ai-clarify-question" id={questionId}>
          {question}
        </p>

        {hasOptions ? (
          <div className="ai-clarify-options" role="group" aria-labelledby={questionId}>
            {options!.map((option) => (
              <button
                key={option.value}
                type="button"
                className="ai-clarify-chip"
                onClick={() => onChoose(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          // An open question (usually a topic): there's nothing to tap, so the composer below is the answer field.
          <p className="ai-clarify-hint">Type your answer below, or ask something else.</p>
        )}
      </div>

      <button
        type="button"
        className="onboarding-dismiss ai-clarify-close"
        onClick={onCancel}
        aria-label="Cancel this question and get a coaching answer instead"
      >
        <X size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
