import { useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, ISSUE_TYPES } from '../config';
import type { QueryContext } from '../types';

// The teaching-context icon in the TopBar (Coach page only — see CoachPage's
// `extraControl`, which sits in the slot the profile chip used to occupy
// there before it moved to the Sidebar footer). Replaces the old ContextBar,
// which held Grade/Subject/Language as permanently-visible pills above the
// composer: all five fields now live behind one icon so they no longer take
// a permanent strip of the chat interface, matching how the model/mode
// selectors already work (a trigger + a popover, nothing shown unless asked
// for). Same context/language state CoachPage has always owned — no new
// state, no duplicated vocab lists.

interface TeachingContextMenuProps {
  language: string;
  onLanguageChange: (value: string) => void;
  context: QueryContext;
  onContextChange: (key: keyof QueryContext, value: string) => void;
}

export default function TeachingContextMenu({
  language, onLanguageChange, context, onContextChange,
}: TeachingContextMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, ref, () => setOpen(false));

  // Language isn't counted: it always has a value (defaults to English), so
  // it can never distinguish "set" from "unset" the way the other four can.
  const activeCount = [context.grade, context.subject, context.classroomType, context.issueType].filter(Boolean).length;

  return (
    <div className="context-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn context-menu-btn${activeCount > 0 ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `Teaching context (${activeCount} set)` : 'Teaching context'}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {activeCount > 0 && <span className="context-menu-count">{activeCount}</span>}
      </button>

      {open && (
        <div className="context-menu-popover" role="dialog" aria-label="Teaching context">
          <label className="field">
            Grade
            <select value={context.grade} onChange={(e) => onContextChange('grade', e.target.value)}>
              <option value="">Any</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="field">
            Subject
            <select value={context.subject} onChange={(e) => onContextChange('subject', e.target.value)}>
              <option value="">Any</option>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            Language
            <select value={language} onChange={(e) => onLanguageChange(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>

          <div className="context-menu-divider" role="separator" />
          <span className="context-menu-section-label">More context</span>

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
        </div>
      )}
    </div>
  );
}
