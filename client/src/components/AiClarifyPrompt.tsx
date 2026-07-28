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

// Shown above the composer when the router understood the request but is one
// required value short (milestone M6). Presentational only: it holds no state,
// makes no request, and knows nothing about actions, drafts or navigation.
//
// It exists because of a counter-intuitive rule in the decision policy: MORE
// missing information means FEWER questions. Exactly one gap is worth a single
// tap; two or more means the teacher should see the whole prefilled form, which
// is a better disambiguation surface than a five-turn interrogation on a phone.
// So this component is only ever rendered for one question, with one answer.
//
// Accessibility (CHANGE-12) follows the conventions already in this codebase:
//   - The options are a labelled group, programmatically associated with the
//     question via aria-labelledby, so a screen reader announces what is being
//     asked before reading the choices.
//   - aria-live="polite" because the question appears without the teacher having
//     asked for it, and should not interrupt whatever is being read.
//   - Cancel is a real button with a descriptive label, not an icon alone.
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
          // An open question (a topic, typically). There is nothing to tap, so
          // the composer below IS the answer field — say so rather than showing
          // an empty group.
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
