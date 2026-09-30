import { useRef, useState } from 'react';
import { GraduationCap, ChevronDown, Check } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The Classroom Mode dropdown, on the right of the Composer's controls row (its two attach actions moved under "+", see
// AddMenu). Which modes are on lives in CoachPage, since a mode is a property of the conversation and travels with the
// request; this component owns only its popover's open state.
// Presented as an explicit Off/On choice: the button shows the current state, so a teacher opening it is choosing between
// two states and seeing both spelled out (with what each costs in output) beats inferring the other from a missing tick.

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
  // What the button shows, and what the tooltip and accessible name report. Reads as a selection ("Classroom Mode" /
  // "Assistant Mode") so it still makes sense with more than one mode, and shows the current choice at a glance.
  const selected = OPTIONS.find((o) => o.on === classroomMode)?.label ?? 'Assistant Mode';
  // The control's name is the off-state label ("Assistant Mode"), so only prefix it in the accessible name once a real mode is selected.
  const accessibleLabel = classroomMode ? `Assistant Mode: ${selected}` : 'Assistant Mode';
  // Same shared outside-click + Escape behaviour as the other popovers (profile menu, teaching context, AddMenu).
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
