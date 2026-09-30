import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown } from 'lucide-react';

// How far from the bottom (px) still counts as "at the bottom": generous enough that sub-pixel rounding or an answer's last line doesn't leave the button showing.
const AT_BOTTOM_SLACK = 80;

interface ScrollToBottomProps {
  /** The scroll container to watch — the Coach page's `.chat-scroll`. */
  scrollRef: RefObject<HTMLElement>;
  /** Re-checked whenever this changes, so a newly arrived answer updates the button. */
  watch?: unknown;
  onClick: () => void;
}

/**
 * The ↓ button over a long answer scrolled away from the bottom. The phone layout gives the answer most of the screen, so
 * a long answer doesn't end near the composer and nothing else signals there's more below. Shown only when there's
 * somewhere to go.
 */
export default function ScrollToBottom({ scrollRef, watch, onClick }: ScrollToBottomProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      setVisible(el.scrollHeight - el.scrollTop - el.clientHeight > AT_BOTTOM_SLACK);
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Content can also grow without scrolling: an answer arriving, an image decoding, a section expanding.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (observer) observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [scrollRef, watch]);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="chat-scroll-down"
      onClick={onClick}
      aria-label="Scroll to the latest message"
      title="Scroll to the latest message"
    >
      <ArrowDown size={18} aria-hidden="true" />
    </button>
  );
}
