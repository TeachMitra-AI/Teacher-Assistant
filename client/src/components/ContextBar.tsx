import { useRef, useState } from 'react';
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

export default function ContextBar({ language, onLanguageChange, context, onContextChange }: ContextBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useDismissable(moreOpen, moreRef, () => setMoreOpen(false));

  const moreActiveCount = [context.classroomType, context.issueType].filter(Boolean).length;

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

        {moreOpen && (
          <div className="context-popover" role="dialog" aria-label="More context">
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
    </div>
  );
}
