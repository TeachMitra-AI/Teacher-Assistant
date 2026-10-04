import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
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
  // On short screens the form is taller than the sheet and scrolls. The sheet's scrollbar is thin and the "more below" cue is
  // shown only while content remains past the fold, so the scroll is discoverable without a permanent decoration.
  const sheetRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) return;
    const update = () => setMoreBelow(sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight > 4);
    update();
    sheet.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Content height changes when the form switches view (sign in / register / pending / school picker) without remounting.
    const observer = new MutationObserver(update);
    observer.observe(sheet, { childList: true, subtree: true });
    return () => {
      sheet.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [open, mode]);

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
        ref={sheetRef}
        className={`auth-modal-sheet auth-card${moreBelow ? ' has-more' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="icon-btn auth-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        {/* Remounted per open (and per mode) so a fresh view starts on the right tab without the last open's typed or scrolled state. */}
        {open && <AuthForm key={mode} theme={theme} initialMode={mode} valueStrip={false} />}
        <div className="auth-scroll-cue" aria-hidden="true">
          <ChevronDown size={16} />
        </div>
      </div>
    </div>
  );
}
