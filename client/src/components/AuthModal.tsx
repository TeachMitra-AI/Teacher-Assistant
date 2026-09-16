import { useEffect } from 'react';
import { X } from 'lucide-react';
import AuthForm, { type Mode } from './AuthForm';

// Pop-up sign-in/register reachable from the public landing page (HomePage) —
// same overlay/sheet convention as .help-overlay/.help-sheet (see
// components/HelpSupport.tsx): slides up from the bottom on mobile, rises
// centered on wider screens, and closes on a backdrop click. Always mounted
// so the CSS transition can play; only `open` toggles visibility.
export default function AuthModal({
  open,
  mode,
  theme,
  onClose,
}: {
  open: boolean;
  mode: Mode;
  theme: 'light' | 'dark';
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);

    // The landing page behind must not scroll while the modal is open — on a
    // phone a drag on the backdrop otherwise scrolls the page underneath it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <div className={`auth-modal-overlay${open ? ' show' : ''}`} onClick={onClose} aria-hidden={!open}>
      <div
        className="auth-modal-sheet auth-card"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="icon-btn auth-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        {/* Remounted per open (and per mode) so a fresh view starts on the
            right tab instead of carrying over whatever the previous open
            left typed in or scrolled to. */}
        {open && <AuthForm key={mode} theme={theme} initialMode={mode} />}
      </div>
    </div>
  );
}
