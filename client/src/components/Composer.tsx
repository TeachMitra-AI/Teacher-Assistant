import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic, ArrowUp } from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENTS_ENABLED, CLASSROOM_MODE_ENABLED, MAX_ATTACHMENTS_COUNT, MAX_QUERY_LENGTH,
} from '../config';
import type { useVoiceInput } from '../hooks/useVoiceInput';
import type { useAttachments } from '../hooks/useAttachments';
import AttachmentTray from './AttachmentTray';
import AddMenu from './AddMenu';
import ClassroomModeMenu from './ClassroomModeMenu';

// How tall the text box may grow before it stops and scrolls internally. The
// box starts at exactly one line and grows with the text (see the layout
// effect below) — this is the ceiling, not the height.
const MAX_TEXTAREA_HEIGHT = 200;

// Below this the composer row cannot hold the long placeholder as well as the
// four controls, so a shorter one is used. Matches the breakpoint at which the
// Classroom dropdown drops its own text label.
const NARROW_QUERY = '(max-width: 520px)';

// How wide a string renders in a given element's font. Canvas is the only way
// to ask that question WITHOUT putting the text in the document and measuring
// the result — which is the whole point here, since the element being laid out
// is the one whose layout depends on the answer. One context, reused for every
// call; measuring a 500-character string costs microseconds.
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, styles: CSSStyleDeclaration): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  return measureCtx.measureText(text).width;
}

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // False = everything on ONE line (+ · text · controls). True = the text takes
  // a full-width line of its own and the controls drop beneath it. See the
  // layout effect for how the switch is decided.
  const [stacked, setStacked] = useState(false);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches
  );
  const atMaxAttachments = attachments.attachments.length >= MAX_ATTACHMENTS_COUNT;

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChangeMq = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChangeMq);
    return () => mq.removeEventListener('change', onChangeMq);
  }, []);

  // Auto-grow, driven by the VALUE rather than by the keystroke that changed
  // it. The old version resized inside the textarea's own onChange, which meant
  // every other way text arrives in the box — a welcome-screen quick action, a
  // follow-up chip, voice input, a paste handled by React, clearing on send —
  // left a long prompt crammed into a one-line box until the teacher typed one
  // more character. A layout effect covers all of them from one place, and runs
  // before paint so the box is never briefly the wrong height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function resize() {
      if (!el) return;
      // Measure with the placeholder REMOVED. A textarea's scrollHeight counts
      // its placeholder when the box is empty, so a placeholder that wraps in
      // the narrow single-row slot reports two lines of content that do not
      // exist — the box pinned itself at two lines' height while empty, and
      // then stacked itself because it "needed" the room. Blanking it for the
      // duration of the measurement makes the height a function of what the
      // teacher actually typed, at any viewport and whatever the placeholder
      // happens to say.
      const placeholder = el.placeholder;
      el.placeholder = '';
      // Collapse first: scrollHeight can only report the content's natural
      // height if the element is not already being held open by its own inline
      // height.
      el.style.height = 'auto';
      const styles = getComputedStyle(el);

      // --- one line, or stacked? ---------------------------------------
      //
      // Answered by MEASURING THE TEXT, never by measuring the element. The
      // element's width is an output of this decision — text that wraps in the
      // narrow single-row slot would stack the layout, which widens the box, so
      // the same text fits one line again, which un-stacks it, forever. (An
      // earlier attempt widened the textarea inline before measuring it, which
      // silently does nothing: a flex item's `flex-basis` overrides `width`, so
      // it kept reporting the current layout.)
      //
      // Measuring the string against the row's full width has no such feedback:
      // the row's width does not depend on the answer.
      const row = rowRef.current;
      if (row) {
        const available = row.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        setStacked(el.value.includes('\n') || textWidth(el.value, styles) > available);
      }

      el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
      // Only scroll once the ceiling is actually reached — a permanently
      // scrollable box shows a scrollbar gutter over a single line of text.
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
      el.placeholder = placeholder;
    }

    resize();
    // The same text needs MORE lines in a narrower box, and the height is an
    // inline pixel value — without this, rotating a phone (or opening the
    // on-screen keyboard, which resizes the viewport) leaves the box at its old
    // height with `overflow-y: hidden`, silently clipping what the teacher
    // typed. Cheap: one listener, and it only ever writes two style properties.
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // `stacked` is a dependency because flipping the layout changes the text
    // box's WIDTH, and the height was computed for the old one. It cannot loop:
    // the stacked verdict is measured against the row's width, which does not
    // change with the verdict, so the second pass reaches the same answer and
    // only the height is corrected.
  }, [value, stacked, textareaRef]);

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
      {attachments.error && (
        <p className="attachment-error" role="alert">
          {attachments.error}
        </p>
      )}
      <div
        className={`composer-box${stacked ? ' composer-box--stacked' : ''}${trayItems.length > 0 ? ' composer-box--squared' : ''}`}
      >
        {/* Inside the box, above the text — a staged file reads as part of the
            message being written, not as a separate strip floating above it.
            'preview' shows the picture and no file name (see AttachmentTray).
            Always its own row: a 56px thumbnail cannot share a line with a
            single-line input.

            No `onClearAll`: each thumbnail already carries its own ✕, and a
            SECOND ✕ sitting beside a single photo was read as a second control
            for that same photo rather than as "remove all of them". Removing
            files one at a time is no hardship at MAX_ATTACHMENTS_COUNT (5). */}
        <AttachmentTray
          attachments={trayItems}
          onRemove={attachments.remove}
          disabled={loading}
          variant="preview"
        />
        {/* ONE row: + · text · controls, wrapping to two only once the text
            needs a line of its own. The DOM order is the single-row order;
            the stacked layout is reached by CSS alone (the textarea takes a
            full-width basis and `order: -1`), so nothing re-mounts when the
            layout flips and the caret never moves. */}
        <div className="composer-row" ref={rowRef}>
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
          <textarea
            id="query-input"
            ref={textareaRef}
            className="composer-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_QUERY_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) onSubmit();
            }}
            placeholder={narrow ? 'Ask anything…' : 'Ask anything about teaching…'}
            rows={1}
            aria-label="Your question"
          />
          {/* aria-live so a screen reader hears the remaining budget when it
              appears, without the number being announced on every keystroke
              before then. */}
          {showCharCount && (
            <span className={`char-count${value.length > MAX_QUERY_LENGTH * 0.9 ? ' warn' : ''}`} aria-live="polite">
              {value.length}/{MAX_QUERY_LENGTH}
            </span>
          )}
          <div className="composer-buttons">
            {/* A conversation-level control, so it sits with the other things
                that act on the whole turn. Flag off ⇒ renders nothing. */}
            {CLASSROOM_MODE_ENABLED && (
              <ClassroomModeMenu
                classroomMode={classroomMode}
                onClassroomModeChange={onClassroomModeChange}
                disabled={loading}
              />
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
