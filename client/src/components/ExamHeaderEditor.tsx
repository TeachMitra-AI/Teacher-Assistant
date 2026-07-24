import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ExamPaperMeta } from '../types';

// Teacher-facing "Paper details" form for the exam-paper letterhead
// (school name, exam name, date, time, maximum marks, teacher name, custom
// instructions). Fully optional — every field left blank just means
// ExamHeader.tsx omits or blanks that row on the printed page. Controlled
// component: the parent (GeneratorPage / ResourceWorkspace) owns the
// ExamPaperMeta value and persists it into Resource.structured.examMeta.
export default function ExamHeaderEditor({
  value, onChange,
}: {
  value: ExamPaperMeta;
  onChange: (next: ExamPaperMeta) => void;
}) {
  const [open, setOpen] = useState(false);

  function set<K extends keyof ExamPaperMeta>(key: K, v: ExamPaperMeta[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <section className="exam-editor" aria-label="Paper details">
      <button type="button" className="exam-editor-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        Paper details
        <span className="exam-editor-hint">School name, exam name, date, marks — shown on the printed paper</span>
      </button>

      {open && (
        <div className="exam-editor-grid">
          <label className="ws-field">
            <span className="ws-label">School name</span>
            <input
              type="text" maxLength={120} value={value.schoolName ?? ''}
              onChange={(e) => set('schoolName', e.target.value)}
              placeholder="e.g. Govt Middle School, Rampur"
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">Exam / assessment name</span>
            <input
              type="text" maxLength={120} value={value.examName ?? ''}
              onChange={(e) => set('examName', e.target.value)}
              placeholder="e.g. Unit Test 2 (defaults to the title)"
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">Teacher name</span>
            <input
              type="text" maxLength={80} value={value.teacherName ?? ''}
              onChange={(e) => set('teacherName', e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">
              <input
                type="checkbox" checked={value.showDate ?? false}
                onChange={(e) => set('showDate', e.target.checked)}
                aria-label="Show a Date field on the paper"
              /> Date
            </span>
            <input
              type="text" maxLength={40} value={value.date ?? ''} disabled={!value.showDate}
              onChange={(e) => set('date', e.target.value)}
              placeholder="e.g. 12 August 2026 (leave blank to print a blank line)"
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">
              <input
                type="checkbox" checked={value.showTime ?? false}
                onChange={(e) => set('showTime', e.target.checked)}
                aria-label="Show a Time/Duration field on the paper"
              /> Time / duration
            </span>
            <input
              type="text" maxLength={40} value={value.time ?? ''} disabled={!value.showTime}
              onChange={(e) => set('time', e.target.value)}
              placeholder="e.g. 45 minutes"
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">Maximum marks</span>
            <input
              type="text" maxLength={20} value={value.maxMarks ?? ''}
              onChange={(e) => set('maxMarks', e.target.value)}
              placeholder="e.g. 20"
            />
          </label>
          <label className="ws-field exam-editor-instructions">
            <span className="ws-label">Custom instructions (optional)</span>
            <textarea
              maxLength={500} rows={2} value={value.customInstructions ?? ''}
              onChange={(e) => set('customInstructions', e.target.value)}
              placeholder="e.g. Use of calculator is not allowed."
            />
          </label>
        </div>
      )}
    </section>
  );
}
