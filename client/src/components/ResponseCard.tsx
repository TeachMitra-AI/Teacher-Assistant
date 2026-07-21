import { useEffect, useState } from 'react';
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

  // Stop any speech if the response changes or the card unmounts.
  useEffect(() => {
    return () => stopSpeaking();
  }, [text]);

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
      show('Copied to clipboard', 'success');
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
          <button className={`action-chip${speaking ? ' speaking' : ''}`} onClick={toggleSpeak}>
            {speaking ? '⏹ Stop' : '🔊 Read aloud'}
          </button>
        )}
        <button className="action-chip" onClick={copy}>📋 Copy</button>
        <button className="action-chip whatsapp" onClick={shareWhatsApp}>💬 WhatsApp</button>
        <SaveToLibrary query={query} text={text} language={language} context={context} queryId={queryId} />
      </div>

      {queryId && (
        <div className="feedback-row">
          <span>Was this helpful?</span>
          <button
            className={`feedback-btn${rating === 'helpful' ? ' chosen' : ''}`}
            onClick={() => onFeedback('helpful')}
            disabled={rating !== null}
          >
            👍 Yes
          </button>
          <button
            className={`feedback-btn${rating === 'not_helpful' ? ' chosen' : ''}`}
            onClick={() => onFeedback('not_helpful')}
            disabled={rating !== null}
          >
            👎 No
          </button>
        </div>
      )}
    </div>
  );
}
