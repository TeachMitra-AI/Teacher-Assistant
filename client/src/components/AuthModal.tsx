import { useEffect } from 'react';
import { X } from 'lucide-react';
import AuthForm, { type Mode } from './AuthForm';

// Pop-up sign-in/register from the public landing page (HomePage), using the .help-overlay/.help-sheet convention
// (components/HelpSupport.tsx): slides up on mobile, rises centered on wider screens, closes on backdrop click. Always
// mounted so the CSS transition plays; only `open` toggles visibility.
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

    // The page behind mustn't scroll while open; on a phone a backdrop drag would scroll it.
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
        {/* Remounted per open (and per mode) so a fresh view starts on the right tab without the last open's typed or scrolled state. */}
        {open && <AuthForm key={mode} theme={theme} initialMode={mode} />}
      </div>
    </div>
  );
}
