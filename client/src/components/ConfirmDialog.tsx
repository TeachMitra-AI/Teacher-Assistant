import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// A modal "are you sure?" step for hard-to-undo actions. window.confirm can't show a title plus explanation, can't mark the
// confirm button destructive, and browsers let users suppress it, which disqualifies it for something like granting Super Admin.
// Controlled: the parent owns `open` and both callbacks; nothing renders while closed.
// Uses the .help-overlay conventions (fixed scrim, var(--surface) panel) instead of a native <dialog>, which can't be styled
// consistently across target browsers and has an unthemeable ::backdrop.
// Portalled to document.body: it's rendered from inside whatever page raises it, and a page's cards create stacking contexts
// a z-index can't escape, so in place the scrim drew behind the table it should cover.

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' colours the confirm button destructively. */
  tone?: 'danger' | 'default';
  /** Disables both buttons while the confirmed action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // What had focus when it opened, handed back on close so keyboard users keep their place in the table row.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    // Cancel takes focus, not Confirm: a reflexive Enter should back out of a guarded action.
    cancelRef.current?.focus();
    return () => {
      const previous = returnFocusRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap, written against whatever the panel contains so it survives gaining a link or checkbox.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-overlay"
      // A scrim click cancels, like other dismissable overlays; clicks inside the panel mustn't bubble into it.
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        ref={panelRef}
        className="confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm-title" id="confirm-dialog-title">{title}</h2>
        <p className="confirm-body" id="confirm-dialog-body">{body}</p>
        <div className="confirm-actions">
          <button type="button" className="btn-text" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
