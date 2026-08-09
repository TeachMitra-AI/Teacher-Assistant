import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useRef } from 'react';
import { Mic, ArrowUp, Paperclip } from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENTS_ENABLED, CLASSROOM_MODE_ENABLED, MAX_ATTACHMENTS_COUNT, MAX_QUERY_LENGTH,
} from '../config';
import type { useVoiceInput } from '../hooks/useVoiceInput';
import type { useAttachments } from '../hooks/useAttachments';
import AttachmentTray from './AttachmentTray';
import ModeMenu from './ModeMenu';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  loading: boolean;
  voice: ReturnType<typeof useVoiceInput>;
  attachments: ReturnType<typeof useAttachments>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
}

export default function Composer({
  value, onChange, onSubmit, loading, voice, attachments, textareaRef,
  classroomMode, onClassroomModeChange,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const atMaxAttachments = attachments.attachments.length >= MAX_ATTACHMENTS_COUNT;

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset the input value so selecting the SAME file(s) again (after
    // removing them) still fires a change event — browsers otherwise treat
    // an unchanged file list as a no-op.
    e.target.value = '';
    if (files.length > 0) attachments.add(files);
  }

  const trayItems = attachments.attachments.map((a) => ({ id: a.id, name: a.file.name, kind: a.kind, previewUrl: a.previewUrl }));

  return (
    <form className="composer" onSubmit={onSubmit}>
      <AttachmentTray attachments={trayItems} onRemove={attachments.remove} onClearAll={attachments.clear} disabled={loading} />
      {attachments.error && (
        <p className="attachment-error" role="alert">
          {attachments.error}
        </p>
      )}
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
          {/* Leftmost, where the character count used to sit alone. The count
              moves to its right rather than away, so nothing a teacher relied
              on disappears. Flag off ⇒ this renders nothing at all and the row
              is byte-for-byte what it was. */}
          {CLASSROOM_MODE_ENABLED && (
            <ModeMenu
              classroomMode={classroomMode}
              onClassroomModeChange={onClassroomModeChange}
              disabled={loading}
            />
          )}
          <span className={`char-count${value.length > MAX_QUERY_LENGTH * 0.9 ? ' warn' : ''}`}>
            {value.length}/{MAX_QUERY_LENGTH}
          </span>
          <div className="composer-buttons">
            {ATTACHMENTS_ENABLED && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  onChange={handleFileChange}
                  multiple
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <button
                  type="button"
                  className="icon-btn attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || atMaxAttachments}
                  title={atMaxAttachments ? `Maximum ${MAX_ATTACHMENTS_COUNT} attachments` : 'Attach images or PDFs'}
                  aria-label="Attach images or PDFs"
                >
                  <Paperclip size={18} aria-hidden="true" />
                </button>
              </>
            )}
            {voice.supported && (
              <button
                type="button"
                className={`icon-btn voice-btn${voice.listening ? ' listening' : ''}`}
                onClick={voice.toggle}
                title="Voice input"
                aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
                aria-pressed={voice.listening}
              >
                <Mic size={18} aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              className="composer-send"
              disabled={loading || !value.trim()}
              aria-label="Send question"
              title="Send (Ctrl+Enter)"
            >
              {loading ? <span className="btn-spinner" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
