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
  { on: false, label: 'Off', description: 'Just answer my question' },
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
  // What the tooltip and the accessible name report. Reads as a selection
  // ("Classroom Mode" / "Off") rather than as on/off, so it still makes sense
  // once there is more than one mode to choose between.
  const selected = OPTIONS.find((o) => o.on === classroomMode)?.label ?? 'Off';
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
        aria-label={`Assistant Mode: ${selected}`}
      >
        {/* The button names the CONTROL, the popover names the choices inside
            it — which is what lets a second mode be added without the button's
            label becoming a lie. */}
        <span className="classroom-menu-label">Assistant Mode</span>
        {/* Shown instead of the full label on a narrow screen. With no icon on
            this button there is nothing else to identify it, so it shortens
            rather than disappearing. */}
        <span className="classroom-menu-label-short">Mode</span>
        <ChevronDown size={14} aria-hidden="true" className="classroom-menu-caret" />
      </button>

      {open && (
        <div className="composer-menu-popover composer-menu-popover--right" role="menu" aria-label="Assistant Mode">
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
