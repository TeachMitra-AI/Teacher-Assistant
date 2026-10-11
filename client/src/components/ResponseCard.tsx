import { useEffect, useRef, useState } from 'react';
import { Volume2, Square, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatResponse } from '../lib/format';
import { toSpeechText } from '../lib/speechText';
import { isSpeechSupported, speak, stopSpeaking, type SpeechFailure, type SpeechRequest } from '../lib/tts';
import { useToast } from './Toast';
import SaveToLibrary from './SaveToLibrary';
import ShareMenu from './ShareMenu';
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

// The only two failures worth telling the teacher about; a stop or a replaced request never reaches here (see tts.ts).
function speechErrorMessage(reason: SpeechFailure): string {
  return reason === 'no-voice'
    ? "This device has no voice for the selected language. Add one in its text-to-speech settings, or try another language."
    : "Couldn't read this aloud. Please try again.";
}

export default function ResponseCard({ query, text, language, context, queryId, rating, onFeedback }: ResponseCardProps) {
  const { show } = useToast();
  // True from the tap, including while the browser is still loading voices, so the button never looks idle mid-request.
  const [speaking, setSpeaking] = useState(false);
  // This card's own speech request, so cleanup can't stop speech that another card started.
  const speechRef = useRef<SpeechRequest | null>(null);
  // Shows a Check in place of the Copy icon briefly after a copy, in the button itself with no toast, where the teacher is already looking.
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop this card's speech if the response changes or the card unmounts. Stopping ends the request, which resets `speaking`.
  useEffect(() => {
    return () => {
      stopSpeaking(speechRef.current);
      speechRef.current = null;
    };
  }, [text]);

  // Clears the revert timer on unmount so it can't call setCopied after this card is gone.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  function toggleSpeak() {
    if (speaking) {
      stopSpeaking(speechRef.current);
      speechRef.current = null;
      setSpeaking(false);
      return;
    }
    // Read the cleaned text, not the Markdown source that the card displays.
    const spoken = toSpeechText(text);
    if (!spoken) return;
    setSpeaking(true);
    speechRef.current = speak(spoken, language, () => setSpeaking(false), {
      onError: (reason) => show(speechErrorMessage(reason), 'error'),
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Restart the revert timer instead of stacking one, so repeated clicks keep the Check for a full duration.
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      show('Could not copy', 'error');
    }
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
        <ShareMenu text={text} />
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
