import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// A modal "are you sure?" step for actions that are hard to undo.
//
// Exists because window.confirm — which the delete flows in LibraryPage and
// ResourceView still use — cannot render a title plus an explanatory line,
// cannot mark the confirming button as destructive, and is suppressible by
// the browser after a few dismissals. For an action like granting Super Admin
// that last property is the disqualifying one.
//
// Controlled: the parent owns `open` and both callbacks. Nothing is rendered
// at all while closed, so a closed dialog costs no DOM and no listeners.
//
// Uses the same overlay conventions as .help-overlay (fixed inset-0 scrim,
// var(--surface) panel) rather than a native <dialog>, which cannot be styled
// consistently across the browsers this app targets and whose ::backdrop is
// not themeable the way the rest of the app's overlays are.
//
// Portalled to document.body. Unlike HelpSupport, which is mounted once at the
// app root and is therefore already a child of <body>, this component is
// rendered from inside whatever page raises it — and a page's own cards create
// stacking contexts that a z-index alone cannot escape. Rendered in place, the
// scrim draws BEHIND the table it is supposed to cover (observed on the
// Manage page).

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
  // Whatever had focus when the dialog opened, so it can be handed back on
  // close — otherwise focus falls to <body> and keyboard users lose their
  // place in the table row they were acting on.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    // Cancel takes focus, not Confirm: this dialog guards actions where a
    // reflexive Enter should back out, not proceed.
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
      // Focus trap. Only the two buttons are focusable, but this is written
      // against whatever the panel actually contains so it survives the
      // dialog growing a link or a checkbox later.
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
      // A click on the scrim is a cancel, matching every other dismissable
      // overlay in the app. Clicks inside the panel must not bubble into it.
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
