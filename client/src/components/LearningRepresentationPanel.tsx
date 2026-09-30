// AI Learning Representation System: the suggestion chip under an AI response. Explicit and on-demand only (no
// representation is generated without the teacher asking); it never fires when a turn completes.
import { useState } from 'react';
import { ApiError } from '../api';
import { fetchLearningRepresentation } from '../lib/learningRepresentation';
import LearningRepresentationDisplay from './LearningRepresentationDisplay';
import { ErrorBoundary } from './ErrorBoundary';
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
    // Guards a fast double-click firing two requests: rendering removes the button once `status` is 'loading', but that
    // relies on an asynchronous repaint, so check the state directly.
    if (state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const res = await fetchLearningRepresentation(query, answer);
      // 'verbal_explanation' (or a missing payload, defensively) is a normal outcome, since most answers have no structure a visual would clarify. Not an error.
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
    // aria-live="polite", as in AiPrefillBanner.tsx: a click revealed new content in place without navigation, and "polite"
    // waits for a pause instead of interrupting the screen reader.
    return (
      <div className="lr-panel lr-panel-shown" role="status" aria-live="polite">
        {/* Isolates a malformed AI payload to this card: a shape the views don't check (e.g. a missing `series` array) would
            throw during render and take down the page via App.tsx's root ErrorBoundary. resetKey={state.data} keeps a later
            representation from being blocked by an earlier error, which is moot today but keeps the boundary correct. */}
        <ErrorBoundary fallback={<p className="lr-note">Could not display this content.</p>} resetKey={state.data}>
          <LearningRepresentationDisplay representation={state.representation} data={state.data} />
        </ErrorBoundary>
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
