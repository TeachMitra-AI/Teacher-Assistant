// AI Learning Representation System (ADR Phase D) — the suggestion chip
// under an AI response. Explicit, on-demand only (Product Principle 1 of
// the ADR: no representation generated without the teacher asking) — this
// never fires automatically when a turn completes.
import { useState } from 'react';
import { ApiError } from '../api';
import { fetchLearningRepresentation } from '../lib/learningRepresentation';
import LearningRepresentationDisplay from './LearningRepresentationDisplay';
import type { LearningRepresentationData, LearningRepresentationType } from '../types';

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'shown'; representation: LearningRepresentationType; data: LearningRepresentationData }
  | { status: 'none' }
  | { status: 'error'; message: string };

interface LearningRepresentationPanelProps {
  query: string;
  answer: string;
}

export default function LearningRepresentationPanel({ query, answer }: LearningRepresentationPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'idle' });

  async function handleClick() {
    // Belt-and-braces guard against a fast double-click firing two concurrent
    // requests for the same message: conditional rendering already removes
    // the clickable button once `status` becomes 'loading', but that relies
    // on React having repainted, which is asynchronous. Checking state
    // directly here closes the (narrow, low-consequence) race completely —
    // surfaced during Phase D1 review.
    if (state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const res = await fetchLearningRepresentation(query, answer);
      // 'verbal_explanation' (or a missing data payload, defensively) is a
      // normal, frequent, healthy outcome — most answers have no structure
      // a visual would clarify. Never treated as an error.
      if (res.representation === 'verbal_explanation' || !res.data) {
        setState({ status: 'none' });
      } else {
        setState({ status: 'shown', representation: res.representation, data: res.data });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not generate a visual. Please try again.';
      setState({ status: 'error', message });
    }
  }

  if (state.status === 'shown') {
    // aria-live="polite", matching the convention AiPrefillBanner.tsx already
    // documents for this codebase (CHANGE-12): this announces something that
    // appeared WITHOUT the teacher navigating anywhere — a click revealed new
    // content in place, not a page change. "polite" waits for a pause rather
    // than interrupting whatever the screen reader is already reading.
    // Surfaced during Phase D2 review.
    return (
      <div className="lr-panel lr-panel-shown" role="status" aria-live="polite">
        <LearningRepresentationDisplay representation={state.representation} data={state.data} />
      </div>
    );
  }

  return (
    <div className="lr-panel">
      {state.status === 'idle' && (
        <button type="button" className="lr-chip" onClick={handleClick}>
          <span aria-hidden="true">✨</span> View as visual
        </button>
      )}
      {state.status === 'loading' && (
        <button type="button" className="lr-chip lr-chip-loading" disabled>
          <span className="spinner spinner-sm" aria-hidden="true" /> Generating visual…
        </button>
      )}
      {state.status === 'none' && <p className="lr-note">No additional visual for this answer.</p>}
      {state.status === 'error' && (
        <div className="lr-error" role="alert">
          {state.message}
          <button type="button" className="btn-text" onClick={handleClick}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
