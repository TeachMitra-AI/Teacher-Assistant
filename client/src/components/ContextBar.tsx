import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, ISSUE_TYPES } from '../config';
import type { QueryContext } from '../types';

interface ContextBarProps {
  language: string;
  onLanguageChange: (value: string) => void;
  context: QueryContext;
  onContextChange: (key: keyof QueryContext, value: string) => void;
}

interface PopoverPosition {
  bottom: number;
  right: number;
  left: number | null;
}

// Mirrors the popover-positioning intent of the (now-superseded) CSS: on
// desktop/tablet it hugs the trigger button; below 640px it spans the whole
// composer width instead of the narrow button, so it can never clip past
// the viewport edge regardless of how the context controls wrap — see the
// matching `@media (max-width: 640px)` rule for `.context-popover` in
// index.css. Computed in fixed/viewport coordinates so the popover isn't
// clipped by an ancestor's overflow (e.g. a resized `.composer-dock`).
function measurePopoverPosition(anchorEl: HTMLElement): PopoverPosition {
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  const container = (mobile && anchorEl.closest<HTMLElement>('.composer-dock-inner')) || anchorEl;
  const rect = container.getBoundingClientRect();
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const inset = mobile ? remPx * 0.5 : 0;
  return {
    bottom: window.innerHeight - rect.top + 8,
    right: window.innerWidth - rect.right + inset,
    left: mobile ? rect.left + inset : null,
  };
}

export default function ContextBar({ language, onLanguageChange, context, onContextChange }: ContextBarProps) {
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
        setPosition((prev) => (prev && prev.bottom === next.bottom && prev.right === next.right && prev.left === next.left ? prev : next));
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
          <option value="">Any</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>

      <label className="context-pill">
        <span className="context-pill-label">Subject</span>
        <select value={context.subject} onChange={(e) => onContextChange('subject', e.target.value)}>
          <option value="">Any</option>
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
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          More context{moreActiveCount > 0 ? ` (${moreActiveCount})` : ''}
        </button>

        {moreOpen && position && createPortal(
          <div
            className="context-popover"
            role="dialog"
            aria-label="More context"
            ref={popoverRef}
            style={{
              bottom: position.bottom,
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
