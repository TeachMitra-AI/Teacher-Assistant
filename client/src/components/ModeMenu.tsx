import { useRef, useState } from 'react';
import { Plus, GraduationCap, Check, type LucideIcon } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The "+" button at the left of the Composer and the popover it opens — where a
// teacher turns a chat MODE on or off (see docs/classroom-mode.md §P1).
//
// Built as a LIST from the start even though Classroom Mode is currently its
// only entry. A second mode is then one object in `modes` below rather than a
// restructuring of this file, and the popover's markup, keyboard handling and
// styling never have to change to accommodate it. That costs nothing today.
//
// This component owns only the open/closed state of its own popover. Which
// modes are ON lives in CoachPage, because that is what has to travel with the
// request — a mode is not a property of the composer, it is a property of the
// conversation.

interface ModeItem {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  active: boolean;
  onToggle: () => void;
}

interface ModeMenuProps {
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
  disabled?: boolean;
}

export default function ModeMenu({ classroomMode, onClassroomModeChange, disabled = false }: ModeMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The same dismissal behaviour (outside click + Escape) as the profile menu
  // and ContextBar's "More context" popover, from the same shared hook — so
  // this menu cannot drift into behaving differently from the two popovers a
  // teacher already knows.
  useDismissable(open, ref, () => setOpen(false));

  const modes: ModeItem[] = [
    {
      id: 'classroom',
      icon: GraduationCap,
      label: 'Classroom Mode',
      description: 'Also create a lesson plan, worksheet, quiz, homework and exit ticket',
      active: classroomMode,
      onToggle: () => onClassroomModeChange(!classroomMode),
    },
  ];

  const activeCount = modes.filter((m) => m.active).length;

  return (
    <div className="mode-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn mode-menu-btn${activeCount > 0 ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `Modes (${activeCount} on)` : 'Modes'}
        title="Modes"
      >
        <Plus size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="mode-menu-popover" role="menu" aria-label="Modes">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={mode.active}
                className={`mode-menu-item${mode.active ? ' active' : ''}`}
                onClick={() => {
                  mode.onToggle();
                  setOpen(false);
                }}
              >
                <Icon size={18} aria-hidden="true" className="mode-menu-item-icon" />
                <span className="mode-menu-item-text">
                  <span className="mode-menu-item-label">{mode.label}</span>
                  <span className="mode-menu-item-desc">{mode.description}</span>
                </span>
                {/* Presence of the tick is the state, not colour alone. */}
                {mode.active && <Check size={16} aria-hidden="true" className="mode-menu-item-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
