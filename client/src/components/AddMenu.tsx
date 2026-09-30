import { useRef, useState } from 'react';
import { Plus, Camera, ImagePlus, type LucideIcon } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The "+" button at the left of the Composer and its popover: where a teacher adds something to their question.
// Named AddMenu, not AttachMenu, because "+" is the growth slot for anything added (a saved Library resource, an earlier
// photo, a diagram), not just attachments. A mode isn't an "add" (it changes what the assistant does with the whole turn), so
// it lives on the right of the row (ClassroomModeMenu).
// `actions` is a flat list, fine for two or three items; once longer, group it with a labelled separator between "add" and
// "do" items. Only this menu's open state lives here; the file inputs and validation stay in the Composer.

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
  // Same dismissal (outside click + Escape) as other popovers, from the shared hook, so they behave alike.
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
