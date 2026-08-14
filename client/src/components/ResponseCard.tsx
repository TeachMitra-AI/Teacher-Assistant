import { useEffect, useRef, useState } from 'react';
import { Volume2, Square, Copy, Check, Share2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatResponse } from '../lib/format';
import { isSpeechSupported, speak, stopSpeaking } from '../lib/tts';
import { useToast } from './Toast';
import SaveToLibrary from './SaveToLibrary';
import type { QueryContext } from '../types';

interface ResponseCardProps {
  query: string;
  text: string;
  language: string;
  context: QueryContext;
  queryId: string | null;
  rating: 'helpful' | 'not_helpful' | null;
  onFeedback: (rating: 'helpful' | 'not_helpful') => void;
}

export default function ResponseCard({ query, text, language, context, queryId, rating, onFeedback }: ResponseCardProps) {
  const { show } = useToast();
  const [speaking, setSpeaking] = useState(false);
  // Shows a Check in place of the Copy icon for a moment after a successful
  // copy, in the button itself — no toast, so the confirmation sits right
  // where the teacher's eyes already are.
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop any speech if the response changes or the card unmounts.
  useEffect(() => {
    return () => stopSpeaking();
  }, [text]);

  // Clears the revert timer on unmount so it cannot fire setCopied after this
  // card is gone.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  function toggleSpeak() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(text, language, () => setSpeaking(false));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Restart the revert timer rather than stacking a second one, so
      // repeated clicks keep the Check showing for a full duration instead of
      // reverting early from the first click's timer.
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      show('Could not copy', 'error');
    }
  }

  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  }

  const metaParts = [context.grade, context.subject].filter(Boolean);

  return (
    <div className="ai-message-content">
      {metaParts.length > 0 && (
        <div className="response-meta">
          {context.grade && <span>📚 {context.grade}</span>}
          {context.subject && <span>📖 {context.subject}</span>}
        </div>
      )}

      <div className="response-body" dangerouslySetInnerHTML={{ __html: formatResponse(text) }} />

      <div className="response-actions">
        {isSpeechSupported() && (
          <button
            type="button"
            className={`action-chip${speaking ? ' speaking' : ''}`}
            onClick={toggleSpeak}
            aria-label={speaking ? 'Stop reading' : 'Read aloud'}
            aria-pressed={speaking}
            title={speaking ? 'Stop reading' : 'Read aloud'}
          >
            {speaking ? <Square size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          className="action-chip"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="action-chip" onClick={shareWhatsApp} aria-label="Share" title="Share">
          <Share2 size={15} aria-hidden="true" />
        </button>
        <SaveToLibrary query={query} text={text} language={language} context={context} queryId={queryId} />
        {queryId && (
          <>
            <button
              type="button"
              className={`action-chip${rating === 'helpful' ? ' chosen' : ''}`}
              onClick={() => onFeedback('helpful')}
              disabled={rating !== null}
              aria-label="Like"
              aria-pressed={rating === 'helpful'}
              title="Like"
            >
              <ThumbsUp size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`action-chip${rating === 'not_helpful' ? ' chosen' : ''}`}
              onClick={() => onFeedback('not_helpful')}
              disabled={rating !== null}
              aria-label="Dislike"
              aria-pressed={rating === 'not_helpful'}
              title="Dislike"
            >
              <ThumbsDown size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
