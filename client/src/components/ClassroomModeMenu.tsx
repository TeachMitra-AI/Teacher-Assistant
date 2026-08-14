import { useRef, useState } from 'react';
import { GraduationCap, ChevronDown, Check } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The Classroom Mode dropdown, on the right of the Composer's controls row —
// where the paperclip attach button used to sit (its two actions moved under
// the "+" button, see AddMenu).
//
// Which modes are ON still lives in CoachPage, not here, because that is what
// has to travel with the request — a mode is a property of the conversation,
// not of the composer. This component owns only its own popover's open state.
//
// Presented as an explicit Off/On choice rather than the single tick-to-toggle
// item the old "+" menu used: with the control now showing its current state on
// the button itself, a teacher opening it is choosing between two states, and
// seeing both spelled out (with what each one costs them in output) is clearer
// than inferring the alternative from the absence of a tick.

interface ClassroomModeMenuProps {
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
  disabled?: boolean;
}

const OPTIONS: { on: boolean; label: string; description: string }[] = [
  { on: false, label: 'Assistant Mode', description: 'Just answer my question' },
  {
    on: true,
    label: 'Classroom Mode',
    description: 'Also create a lesson plan, worksheet, quiz, homework and exit ticket',
  },
];

export default function ClassroomModeMenu({
  classroomMode, onClassroomModeChange, disabled = false,
}: ClassroomModeMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // What the button itself displays, and what the tooltip and accessible name
  // report. Reads as a selection ("Classroom Mode" / "Assistant Mode") rather
  // than as on/off, so it still makes sense once there is more than one mode
  // to choose between — and shows the teacher's actual current choice at a
  // glance, rather than a generic control name.
  const selected = OPTIONS.find((o) => o.on === classroomMode)?.label ?? 'Assistant Mode';
  // The control's own name IS the off-state label ("Assistant Mode"), so
  // pairing it with itself in the accessible name would read as a stutter —
  // only prefix it once a real mode is selected.
  const accessibleLabel = classroomMode ? `Assistant Mode: ${selected}` : 'Assistant Mode';
  // Same shared outside-click + Escape behaviour as every other popover in the
  // app (profile menu, teaching context, AddMenu).
  useDismissable(open, ref, () => setOpen(false));

  return (
    <div className="composer-menu classroom-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn classroom-menu-btn${classroomMode ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        <span className="classroom-menu-label">{selected}</span>
        <ChevronDown size={14} aria-hidden="true" className="classroom-menu-caret" />
      </button>

      {open && (
        <div className="composer-menu-popover" role="menu" aria-label="Assistant Mode">
          {OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={option.on === classroomMode}
              className={`composer-menu-item${option.on === classroomMode ? ' active' : ''}`}
              onClick={() => {
                onClassroomModeChange(option.on);
                setOpen(false);
              }}
            >
              <GraduationCap size={18} aria-hidden="true" className="composer-menu-item-icon" />
              <span className="composer-menu-item-text">
                <span className="composer-menu-item-label">{option.label}</span>
                <span className="composer-menu-item-desc">{option.description}</span>
              </span>
              {/* Presence of the tick is the state, not colour alone. */}
              {option.on === classroomMode && (
                <Check size={16} aria-hidden="true" className="composer-menu-item-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
