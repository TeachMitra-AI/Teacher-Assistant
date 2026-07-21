import type { RefObject } from 'react';
import MessageBubble from './MessageBubble';
import type { FollowUpAction } from '../config';
import type { Turn } from '../types';

interface MessageListProps {
  turns: Turn[];
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
  onFollowUp: (turn: Turn, action: FollowUpAction) => void;
  onRetry: (turn: Turn) => void;
  bottomRef: RefObject<HTMLDivElement>;
}

export default function MessageList({ turns, onFeedback, onFollowUp, onRetry, bottomRef }: MessageListProps) {
  return (
    <div className="message-list">
      {turns.map((turn) => (
        <MessageBubble key={turn.id} turn={turn} onFeedback={onFeedback} onFollowUp={onFollowUp} onRetry={onRetry} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
