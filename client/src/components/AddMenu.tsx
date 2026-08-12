import { useRef, useState } from 'react';
import { Plus, Camera, ImagePlus, type LucideIcon } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The "+" button at the left of the Composer and the popover it opens — the one
// place a teacher ADDS something to their question.
//
// Named AddMenu, not AttachMenu, on purpose. Today its two items both attach a
// file, but "+" is the growth slot for anything a teacher adds to a message:
// pick a saved resource from the Library, insert a photo they took earlier,
// generate a diagram. Those are not attachments, and a component called
// AttachMenu would either be renamed a third time or quietly start lying about
// what it holds.
//
// A MODE is not an "add" and does not belong here — it changes what the
// assistant does with the whole turn, so it lives on the right of the same row
// (ClassroomModeMenu).
//
// GROWTH PATH: `actions` below is a flat list, which is right for two or three
// items. Once it is longer, group it — a labelled separator between "add
// something" items and "do something" items — rather than letting one flat list
// grow past what a teacher can scan. Nothing else in this file has to change
// for that: the button, dismissal, keyboard handling and styling are all
// independent of how many items there are.
//
// This component owns only the open/closed state of its own popover. The file
// inputs themselves stay in the Composer, which owns the attachment state and
// its validation — this menu only says which one to open.

interface AddAction {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  onSelect: () => void;
}

interface AddMenuProps {
  /** Opens the camera directly (a hidden input with `capture`). */
  onCapturePhoto: () => void;
  /** Opens the ordinary OS file picker (images or PDFs). */
  onUploadFile: () => void;
  disabled?: boolean;
  /** True once MAX_ATTACHMENTS_COUNT files are staged — the button stays visible but refuses to add more. */
  atMax?: boolean;
  /** Tooltip/aria text for the button, so the Composer can explain *why* it is disabled. */
  title?: string;
}

export default function AddMenu({
  onCapturePhoto, onUploadFile, disabled = false, atMax = false, title,
}: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The same dismissal behaviour (outside click + Escape) as the profile menu
  // and ContextBar's "More context" popover, from the same shared hook — so
  // this menu cannot drift into behaving differently from the two popovers a
  // teacher already knows.
  useDismissable(open, ref, () => setOpen(false));

  const actions: AddAction[] = [
    {
      id: 'capture',
      icon: Camera,
      label: 'Capture Photo',
      description: 'Take a photo of a page, board or notebook',
      onSelect: onCapturePhoto,
    },
    {
      id: 'upload',
      icon: ImagePlus,
      label: 'Upload File/Photo',
      description: 'Choose an image or PDF from this device',
      onSelect: onUploadFile,
    },
  ];

  return (
    <div className="composer-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn composer-menu-btn"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || atMax}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to your question"
        title={title ?? 'Add photos and files'}
      >
        <Plus size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="composer-menu-popover" role="menu" aria-label="Add to your question">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="composer-menu-item"
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
              >
                <Icon size={18} aria-hidden="true" className="composer-menu-item-icon" />
                <span className="composer-menu-item-text">
                  <span className="composer-menu-item-label">{action.label}</span>
                  <span className="composer-menu-item-desc">{action.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
