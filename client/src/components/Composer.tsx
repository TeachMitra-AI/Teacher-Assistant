import type { FormEvent, RefObject } from 'react';
import { MAX_QUERY_LENGTH } from '../config';
import type { useVoiceInput } from '../hooks/useVoiceInput';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  loading: boolean;
  voice: ReturnType<typeof useVoiceInput>;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export default function Composer({ value, onChange, onSubmit, loading, voice, textareaRef }: ComposerProps) {
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-box">
        <textarea
          id="query-input"
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => {
            onChange(e.target.value.slice(0, MAX_QUERY_LENGTH));
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) onSubmit();
          }}
          placeholder="Ask anything about teaching…"
          rows={1}
          aria-label="Your question"
        />
        <div className="composer-controls">
          <span className={`char-count${value.length > MAX_QUERY_LENGTH * 0.9 ? ' warn' : ''}`}>
            {value.length}/{MAX_QUERY_LENGTH}
          </span>
          <div className="composer-buttons">
            {voice.supported && (
              <button
                type="button"
                className={`icon-btn voice-btn${voice.listening ? ' listening' : ''}`}
                onClick={voice.toggle}
                title="Voice input"
                aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
                aria-pressed={voice.listening}
              >
                🎤
              </button>
            )}
            <button
              type="submit"
              className="composer-send"
              disabled={loading || !value.trim()}
              aria-label="Send question"
              title="Send (Ctrl+Enter)"
            >
              {loading ? <span className="btn-spinner" aria-hidden="true" /> : '↑'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
