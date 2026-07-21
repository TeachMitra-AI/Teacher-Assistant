import ResponseCard from './ResponseCard';
import FollowUpChips from './FollowUpChips';
import type { FollowUpAction } from '../config';
import type { Turn } from '../types';

interface MessageBubbleProps {
  turn: Turn;
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
  onFollowUp: (turn: Turn, action: FollowUpAction) => void;
  onRetry: (turn: Turn) => void;
}

export default function MessageBubble({ turn, onFeedback, onFollowUp, onRetry }: MessageBubbleProps) {
  return (
    <div className="message-group">
      <div className="message message-user">
        <div className="message-bubble user-bubble">{turn.query}</div>
      </div>

      <div className="message message-assistant">
        {turn.status === 'pending' && (
          <div className="message-bubble assistant-pending" role="status" aria-live="polite">
            <span className="spinner spinner-sm" aria-hidden="true" />
            Preparing practical advice for you…
          </div>
        )}

        {turn.status === 'error' && (
          <div className="message-bubble assistant-error" role="alert">
            <span aria-hidden="true">⚠️</span> {turn.error}
            <button type="button" className="btn-text retry-btn" onClick={() => onRetry(turn)}>Try again</button>
          </div>
        )}

        {turn.status === 'done' && turn.response && (
          <>
            <ResponseCard
              query={turn.query}
              text={turn.response.text}
              language={turn.response.language}
              context={turn.response.context}
              queryId={turn.response.queryId}
              rating={turn.rating}
              onFeedback={(rating) => onFeedback(turn.id, rating)}
            />
            <FollowUpChips language={turn.response.language} onAction={(action) => onFollowUp(turn, action)} />
          </>
        )}
      </div>
    </div>
  );
}
