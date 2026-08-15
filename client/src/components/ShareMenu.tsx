import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, MessageCircle, Send, Camera } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { useToast } from './Toast';

// The Share action on a response card: opens a small popover offering
// WhatsApp, Telegram and Instagram instead of jumping straight to WhatsApp.
// Portalled to document.body for the same reason HistoryItemMenu is — this
// button lives inside `.chat-scroll` (overflow-y: auto), which would clip an
// un-portalled popover the moment the card isn't near the bottom of the
// thread. Its own compact `.share-menu-popover`/`.share-menu-item` classes
// (index.css) rather than HistoryItemMenu's — a 3-item share sheet reads as
// its own minimal affordance, not a reuse of the taller chat-actions list.
//
// Instagram has no web API for prefilled-text sharing (unlike wa.me or
// Telegram's t.me/share/url) — the content is copied to the clipboard and
// Instagram opens in a new tab so the teacher can paste it themselves. That
// is the standard, technically-honest fallback other products use for the
// same limitation, not a fake deep link that silently does nothing.

interface Position {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const POPOVER_APPROX_HEIGHT = 150;
const POPOVER_MIN_WIDTH = 164;

function computePosition(anchorEl: HTMLElement): Position {
  const rect = anchorEl.getBoundingClientRect();
  const position: Position = {};
  if (window.innerHeight - rect.bottom < POPOVER_APPROX_HEIGHT) {
    position.bottom = window.innerHeight - rect.top + 6;
  } else {
    position.top = rect.bottom + 6;
  }
  if (window.innerWidth - rect.left < POPOVER_MIN_WIDTH) {
    position.right = window.innerWidth - rect.right;
  } else {
    position.left = rect.left;
  }
  return position;
}

interface ShareMenuProps {
  /** The response text to share. */
  text: string;
}

export default function ShareMenu({ text }: ShareMenuProps) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const dismissRefs = useMemo(() => [triggerRef, popoverRef], []);
  useDismissable(open, dismissRefs, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }
    setPosition(computePosition(triggerRef.current));
    function close() { setOpen(false); }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !position) return;
    const firstItem = popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, [open, position]);

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    setOpen(false);
  }

  function shareTelegram() {
    window.open(`https://t.me/share/url?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    setOpen(false);
  }

  async function shareInstagram() {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(text);
      show('Copied — paste it into Instagram', 'success');
    } catch {
      show('Could not copy', 'error');
    }
    window.open('https://www.instagram.com/', '_blank', 'noopener');
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`action-chip${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share"
        title="Share"
      >
        <Share2 size={15} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div
          ref={popoverRef}
          className="share-menu-popover"
          role="menu"
          aria-label="Share"
          style={{
            top: position.top ?? 'auto',
            bottom: position.bottom ?? 'auto',
            left: position.left ?? 'auto',
            right: position.right ?? 'auto',
          }}
        >
          <button type="button" role="menuitem" className="share-menu-item" onClick={shareWhatsApp}>
            <MessageCircle size={16} aria-hidden="true" /> WhatsApp
          </button>
          <button type="button" role="menuitem" className="share-menu-item" onClick={shareTelegram}>
            <Send size={16} aria-hidden="true" /> Telegram
          </button>
          <button type="button" role="menuitem" className="share-menu-item" onClick={shareInstagram}>
            <Camera size={16} aria-hidden="true" /> Instagram
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
