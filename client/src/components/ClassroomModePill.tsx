import { GraduationCap, X } from 'lucide-react';

// The "Classroom Mode is on" indicator, shown directly above the Composer.
//
// Not decoration. Classroom Mode is the one feature where a single question
// costs several model calls instead of one, and it stays on across questions —
// so a teacher must be able to SEE that it is on without remembering they
// switched it on. An invisible sticky mode that quietly multiplies spend is the
// failure this component exists to prevent (docs/classroom-mode.md D3, D16).
//
// It carries its own "turn it off" control rather than sending the teacher back
// into the "+" menu: the fastest possible exit from a mode is what makes leaving
// it on feel safe.

interface ClassroomModePillProps {
  onDismiss: () => void;
}

export default function ClassroomModePill({ onDismiss }: ClassroomModePillProps) {
  return (
    <div className="classroom-pill" role="status">
      <GraduationCap size={15} aria-hidden="true" />
      <span className="classroom-pill-label">Classroom Mode</span>
      <span className="classroom-pill-hint">materials are created when your question has a topic</span>
      <button
        type="button"
        className="classroom-pill-close"
        onClick={onDismiss}
        aria-label="Turn off Classroom Mode"
        title="Turn off Classroom Mode"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
