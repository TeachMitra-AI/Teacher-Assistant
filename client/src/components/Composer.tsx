import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { Mic, ArrowUp, Square } from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENTS_ENABLED, CLASSROOM_MODE_ENABLED, MAX_ATTACHMENTS_COUNT, MAX_QUERY_LENGTH,
} from '../config';
import type { useVoiceInput } from '../hooks/useVoiceInput';
import type { useAttachments } from '../hooks/useAttachments';
import { useMediaQuery } from '../hooks/useMediaQuery';
import AttachmentTray from './AttachmentTray';
import AddMenu from './AddMenu';
import ClassroomModeMenu from './ClassroomModeMenu';

// Ceiling for how tall the text box grows before it scrolls internally; it starts at one line and grows with the text.
const MAX_TEXTAREA_HEIGHT = 200;

// Below this width the placeholder shortens, since the long one would wrap while the box is empty.
const NARROW_QUERY = '(max-width: 520px)';
const TINY_QUERY = '(max-width: 360px)';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  loading: boolean;
  /** A coach request is in flight and can actually be cancelled (as opposed to `loading`'s other causes, like the
   *  router's brief pre-pass or the API-cooldown wait, which have nothing to abort). Swaps the send button for Stop. */
  canStop: boolean;
  onStop: () => void;
  voice: ReturnType<typeof useVoiceInput>;
  attachments: ReturnType<typeof useAttachments>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
  /** Set while every Gemini API key is exhausted (hooks/useRetryCountdown.ts); shown in place of the attachment error to explain why `loading` is true. */
  cooldownMessage?: string;
}

export default function Composer({
  value, onChange, onSubmit, loading, canStop, onStop, voice, attachments, textareaRef,
  classroomMode, onClassroomModeChange, cooldownMessage,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const tiny = useMediaQuery(TINY_QUERY);
  const atMaxAttachments = attachments.attachments.length >= MAX_ATTACHMENTS_COUNT;

  // Auto-grow is driven by the value, not the keystroke: resizing in onChange left text that arrives another way (a quick
  // action, follow-up chip, voice input, paste, clear on send) crammed into a one-line box. A layout effect covers all of
  // them and runs before paint. The textarea has its own full-width row, so this only measures the text's own height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function resize() {
      if (!el) return;
      // Collapse first: scrollHeight only reports the natural height if the inline height isn't holding it open.
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
      // Scroll only once the ceiling is reached; an always-scrollable box shows a scrollbar gutter over one line.
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
    }

    resize();
    // The same text needs more lines in a narrower box and the height is inline pixels, so rotating a phone or opening the
    // on-screen keyboard would leave the old height and clip typed text. Cheap: one listener, two style writes.
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [value, textareaRef]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset the value so re-selecting the same file(s) after removing them still fires a change event.
    e.target.value = '';
    if (files.length > 0) attachments.add(files);
  }

  const trayItems = attachments.attachments.map((a) => ({ id: a.id, name: a.file.name, kind: a.kind, previewUrl: a.previewUrl }));
  // Shown only as the limit approaches; a permanent "0/500" wastes a slot on a row that should be quiet.
  const showCharCount = value.length > MAX_QUERY_LENGTH * 0.8;

  return (
    <form className="composer" onSubmit={onSubmit}>
      {cooldownMessage ? (
        <p className="attachment-error" role="alert">
          {cooldownMessage}
        </p>
      ) : (
        attachments.error && (
          <p className="attachment-error" role="alert">
            {attachments.error}
          </p>
        )
      )}
      <div className="composer-box">
        {/* Inside the box, above the text, so a staged file reads as part of the message. 'preview' shows the picture and no file name (see AttachmentTray). */}
        <AttachmentTray
          attachments={trayItems}
          onRemove={attachments.remove}
          disabled={loading}
          variant="preview"
        />
        {/* Top: the message, full width, growing with the text. Bottom: every control on its own row, so they never compete for width. */}
        <textarea
          id="query-input"
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_QUERY_LENGTH))}
          onKeyDown={(e) => {
            // Enter sends (Shift+Enter for a newline), the standard chat convention. Guarded on `loading`, since a keyboard
            // shortcut bypasses the submit button's `disabled` and mashing Enter mustn't queue submissions.
            if (e.key === 'Enter' && !e.shiftKey && !loading) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={tiny ? 'Ask…' : narrow ? 'Ask anything…' : 'Ask anything about teaching…'}
          rows={1}
          aria-label="Your question"
        />
        <div className="composer-controls">
          <div className="composer-controls-left">
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
                {/* A second input rather than toggling `capture` on the one above: `capture` is read when the picker opens and
                    browsers differ on re-reading a mutated attribute. Not `multiple`, since a camera returns one shot. */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <AddMenu
                  onCapturePhoto={() => cameraInputRef.current?.click()}
                  onUploadFile={() => fileInputRef.current?.click()}
                  disabled={loading}
                  atMax={atMaxAttachments}
                  title={atMaxAttachments ? `Maximum ${MAX_ATTACHMENTS_COUNT} attachments` : 'Add photos and files'}
                />
              </>
            )}
            {/* A conversation-level control, so it sits with the other turn-wide controls. Flag off ⇒ renders nothing. */}
            {CLASSROOM_MODE_ENABLED && (
              <ClassroomModeMenu
                classroomMode={classroomMode}
                onClassroomModeChange={onClassroomModeChange}
                disabled={loading}
              />
            )}
          </div>
          <div className="composer-controls-right">
            {/* aria-live so a screen reader hears the remaining budget when it appears, not on every earlier keystroke. */}
            {showCharCount && (
              <span className={`char-count${value.length > MAX_QUERY_LENGTH * 0.9 ? ' warn' : ''}`} aria-live="polite">
                {value.length}/{MAX_QUERY_LENGTH}
              </span>
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
            {canStop ? (
              <button
                type="button"
                className="composer-send composer-send--stop"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square size={14} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                className="composer-send"
                disabled={loading || !value.trim()}
                aria-label="Send question"
                title="Send (Ctrl+Enter)"
              >
                {loading ? <span className="btn-spinner" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
