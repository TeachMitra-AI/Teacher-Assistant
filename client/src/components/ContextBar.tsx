import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, ISSUE_TYPES } from '../config';
import type { QueryContext } from '../types';

interface ContextBarProps {
  language: string;
  onLanguageChange: (value: string) => void;
  context: QueryContext;
  onContextChange: (key: keyof QueryContext, value: string) => void;
}

interface PopoverPosition {
  /** Set when the popover opens UPWARD (the control is near the bottom). */
  bottom: number | null;
  /** Set when it opens DOWNWARD (the control is near the top). */
  top: number | null;
  right: number;
  left: number | null;
}

// Roughly how tall the popover is (two labelled selects plus its padding).
// Only used to decide which way it opens, so an approximation is enough — being
// a little pessimistic just means opening downward slightly sooner.
const POPOVER_APPROX_HEIGHT = 230;

// Mirrors the popover-positioning intent of the (now-superseded) CSS: on
// desktop/tablet it hugs the trigger button; below 640px it spans the whole
// context row instead of the narrow button, so it can never clip past the
// viewport edge regardless of how the context controls wrap — see the matching
// `@media (max-width: 640px)` rule for `.context-popover` in index.css.
// Computed in fixed/viewport coordinates so the popover isn't clipped by an
// ancestor's overflow (e.g. a resized `.composer-dock`).
function measurePopoverPosition(anchorEl: HTMLElement): PopoverPosition {
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  // The row itself, not the composer dock: on a phone this control now lives
  // under the header, where there is no dock to measure against.
  const container = (mobile && anchorEl.closest<HTMLElement>('.context-bar')) || anchorEl;
  const rect = container.getBoundingClientRect();
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const inset = mobile ? remPx * 0.5 : 0;
  const horizontal = {
    right: window.innerWidth - rect.right + inset,
    left: mobile ? rect.left + inset : null,
  };
  // Opening upward is the default — the control spent its whole life at the
  // bottom of the screen. Now that the phone layout puts it under the header
  // there is nothing above it to open into, so it flips when the space isn't
  // there. Measured rather than tied to the breakpoint, so it also does the
  // right thing for a short viewport or a landscape phone.
  if (rect.top < POPOVER_APPROX_HEIGHT) {
    return { top: rect.bottom + 8, bottom: null, ...horizontal };
  }
  return { bottom: window.innerHeight - rect.top + 8, top: null, ...horizontal };
}

export default function ContextBar({ language, onLanguageChange, context, onContextChange }: ContextBarProps) {
  // On a phone this row sits under the header and has to hold three filters
  // plus a button across as little as 320px. Rather than shrinking every
  // control until the row is cramped (which is what a separate "Grade" label
  // plus an "Any" value forced), the LABEL is dropped there and the empty
  // option names the field itself.
  const phone = useMediaQuery('(max-width: 640px)');
  // "Grade" rather than "Any grade": the longer form truncated to "Any gra…"
  // inside a control narrow enough to fit the row, which says less than the
  // field name alone. Unset reads as a placeholder naming the filter; set reads
  // as the value ("Class 6-8"), which names its own field anyway.
  const anyLabel = (field: string) => (phone ? field : 'Any');

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  // Stable identity so useDismissable's effect doesn't tear down/re-attach
  // its listeners on every render.
  const dismissRefs = useMemo(() => [moreRef, popoverRef], []);
  useDismissable(moreOpen, dismissRefs, () => setMoreOpen(false));

  const moreActiveCount = [context.classroomType, context.issueType].filter(Boolean).length;

  // The popover renders in a portal (below) so it can escape `.composer-dock`'s
  // scroll clipping once the chat/composer resize handle has shrunk it — an
  // absolutely-positioned descendant extending above a scrollable ancestor
  // gets clipped by that ancestor's overflow, not just the viewport. Position
  // is re-measured every frame while open so a composer resize drag (which
  // moves the anchor without firing a scroll/resize DOM event) never leaves
  // it pinned to a stale spot.
  useLayoutEffect(() => {
    if (!moreOpen) {
      setPosition(null);
      return;
    }
    let frame: number;
    function measure() {
      if (moreRef.current) {
        const next = measurePopoverPosition(moreRef.current);
        setPosition((prev) => (
          prev && prev.bottom === next.bottom && prev.top === next.top && prev.right === next.right && prev.left === next.left
            ? prev
            : next
        ));
      }
      frame = requestAnimationFrame(measure);
    }
    measure();
    return () => cancelAnimationFrame(frame);
  }, [moreOpen]);

  return (
    <div className="context-bar">
      <label className="context-pill">
        <span className="context-pill-label">Grade</span>
        <select value={context.grade} onChange={(e) => onContextChange('grade', e.target.value)}>
          <option value="">{anyLabel('Grade')}</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>

      <label className="context-pill">
        <span className="context-pill-label">Subject</span>
        <select value={context.subject} onChange={(e) => onContextChange('subject', e.target.value)}>
          <option value="">{anyLabel('Subject')}</option>
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="context-pill">
        <span className="context-pill-label">Language</span>
        <select value={language} onChange={(e) => onLanguageChange(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>

      <div className="context-more" ref={moreRef}>
        <button
          type="button"
          className={`context-more-btn${moreActiveCount > 0 ? ' active' : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          // The accessible name never collapses with the visible text below —
          // on a phone the button is icon-only, and "More context" is the only
          // thing that says what it does.
          aria-label={moreActiveCount > 0 ? `More context (${moreActiveCount} set)` : 'More context'}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {/* Hidden on phones, where this row has to hold three selects and
              this button across a 320px screen. The icon and the count dot
              carry it there; the full label returns on tablet and up. */}
          <span className="context-more-text">More context</span>
          {moreActiveCount > 0 && <span className="context-more-count">{moreActiveCount}</span>}
        </button>

        {moreOpen && position && createPortal(
          <div
            className="context-popover"
            role="dialog"
            aria-label="More context"
            ref={popoverRef}
            style={{
              // Exactly one of top/bottom is applied and THE OTHER IS EXPLICITLY
              // 'auto'. Leaving it unset is not enough: the stylesheet's own
              // `bottom: calc(100% + 8px)` would still apply, and an element
              // pinned to both edges is stretched between them — which
              // collapsed the panel and left its two fields hanging outside it.
              top: position.top ?? 'auto',
              bottom: position.bottom ?? 'auto',
              right: position.right,
              ...(position.left != null ? { left: position.left } : {}),
            }}
          >
            <label className="field">
              Classroom
              <select value={context.classroomType} onChange={(e) => onContextChange('classroomType', e.target.value)}>
                <option value="">Any</option>
                {CLASSROOM_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              Focus
              <select value={context.issueType} onChange={(e) => onContextChange('issueType', e.target.value)}>
                <option value="">Any</option>
                {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
