import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { Mic, ArrowUp } from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENTS_ENABLED, CLASSROOM_MODE_ENABLED, MAX_ATTACHMENTS_COUNT, MAX_QUERY_LENGTH,
} from '../config';
import type { useVoiceInput } from '../hooks/useVoiceInput';
import type { useAttachments } from '../hooks/useAttachments';
import { useMediaQuery } from '../hooks/useMediaQuery';
import AttachmentTray from './AttachmentTray';
import AddMenu from './AddMenu';
import ClassroomModeMenu from './ClassroomModeMenu';

// How tall the text box may grow before it stops and scrolls internally. The
// box starts at exactly one line and grows with the text (see the layout
// effect below) — this is the ceiling, not the height.
const MAX_TEXTAREA_HEIGHT = 200;

// Below this the placeholder shortens — a phone this narrow cannot show the
// long invitation without it wrapping onto a second line while the box is
// still empty.
const NARROW_QUERY = '(max-width: 520px)';
const TINY_QUERY = '(max-width: 360px)';

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
  /** Set while every Gemini API key is exhausted (see hooks/useRetryCountdown.ts)
   *  — shown in place of the attachment error, explaining why `loading` is
   *  true for reasons beyond a normal in-flight request. */
  cooldownMessage?: string;
}

export default function Composer({
  value, onChange, onSubmit, loading, voice, attachments, textareaRef,
  classroomMode, onClassroomModeChange, cooldownMessage,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const tiny = useMediaQuery(TINY_QUERY);
  const atMaxAttachments = attachments.attachments.length >= MAX_ATTACHMENTS_COUNT;

  // Auto-grow, driven by the VALUE rather than by the keystroke that changed
  // it. The old version resized inside the textarea's own onChange, which meant
  // every other way text arrives in the box — a welcome-screen quick action, a
  // follow-up chip, voice input, a paste handled by React, clearing on send —
  // left a long prompt crammed into a one-line box until the teacher typed one
  // more character. A layout effect covers all of them from one place, and runs
  // before paint so the box is never briefly the wrong height.
  //
  // The text area now always occupies a full-width row of its own (the
  // controls live in a separate row beneath it), so growing it no longer has
  // any effect on how anything else in the composer is laid out — this only
  // ever measures the text's own height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function resize() {
      if (!el) return;
      // Collapse first: scrollHeight can only report the content's natural
      // height if the element is not already being held open by its own inline
      // height.
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
      // Only scroll once the ceiling is actually reached — a permanently
      // scrollable box shows a scrollbar gutter over a single line of text.
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
    }

    resize();
    // The same text needs MORE lines in a narrower box, and the height is an
    // inline pixel value — without this, rotating a phone (or opening the
    // on-screen keyboard, which resizes the viewport) leaves the box at its old
    // height with `overflow-y: hidden`, silently clipping what the teacher
    // typed. Cheap: one listener, and it only ever writes two style properties.
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [value, textareaRef]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset the input value so selecting the SAME file(s) again (after
    // removing them) still fires a change event — browsers otherwise treat
    // an unchanged file list as a no-op.
    e.target.value = '';
    if (files.length > 0) attachments.add(files);
  }

  const trayItems = attachments.attachments.map((a) => ({ id: a.id, name: a.file.name, kind: a.kind, previewUrl: a.previewUrl }));
  // Shown only as the limit approaches. A permanent "0/500" spends a slot on
  // the one row the composer has to say nothing — the number only carries
  // information once running out is a real possibility.
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
        {/* Inside the box, above the text — a staged file reads as part of the
            message being written, not as a separate strip floating above it.
            'preview' shows the picture and no file name (see AttachmentTray). */}
        <AttachmentTray
          attachments={trayItems}
          onRemove={attachments.remove}
          disabled={loading}
          variant="preview"
        />
        {/* Top: the message itself, full width, growing with the text. Bottom:
            every control, on a row of its own — the two never compete for the
            same cramped horizontal space, on any screen size. */}
        <textarea
          id="query-input"
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_QUERY_LENGTH))}
          onKeyDown={(e) => {
            // Enter sends (Shift+Enter for a newline) — the standard chat-app
            // convention (ChatGPT, Slack, etc.), not the browser's default
            // textarea behavior of Enter always inserting a newline. Guarded
            // on `loading` since a keyboard shortcut bypasses the submit
            // button's `disabled` attribute — mashing Enter while a response
            // is still in flight must not queue up extra submissions.
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
                {/* A SECOND input, not a `capture` attribute toggled on the one
                    above: `capture` is read when the picker opens, and browsers
                    differ on whether re-reading a mutated attribute takes effect.
                    Two fixed inputs make "camera" and "file picker" two different
                    elements, which every browser gets right. Deliberately not
                    `multiple` — a camera returns one shot. */}
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
            {/* A conversation-level control, so it sits with the other things
                that act on the whole turn. Flag off ⇒ renders nothing. */}
            {CLASSROOM_MODE_ENABLED && (
              <ClassroomModeMenu
                classroomMode={classroomMode}
                onClassroomModeChange={onClassroomModeChange}
                disabled={loading}
              />
            )}
          </div>
          <div className="composer-controls-right">
            {/* aria-live so a screen reader hears the remaining budget when it
                appears, without the number being announced on every keystroke
                before then. */}
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
