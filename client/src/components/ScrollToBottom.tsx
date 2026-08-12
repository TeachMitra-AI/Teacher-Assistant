import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown } from 'lucide-react';

// How far from the bottom (px) still counts as "at the bottom". Generous
// enough that a couple of pixels of sub-pixel rounding, or the last line of an
// answer, never leaves the button hanging around over content the teacher has
// already reached.
const AT_BOTTOM_SLACK = 80;

interface ScrollToBottomProps {
  /** The scroll container to watch — the Coach page's `.chat-scroll`. */
  scrollRef: RefObject<HTMLElement>;
  /** Re-checked whenever this changes, so a newly arrived answer updates the button. */
  watch?: unknown;
  onClick: () => void;
}

/**
 * The ↓ button that appears over a long answer once it has been scrolled away
 * from the bottom.
 *
 * It exists because the phone layout gives the answer most of the screen, which
 * means a long answer no longer ends anywhere near the composer — without this,
 * the only sign that there is more below is the absence of an edge. Shown ONLY
 * when there is somewhere to go: it never covers content the teacher has
 * already read to the end of.
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
    // The content can also grow without any scrolling — an answer arriving, an
    // image finishing decoding, a section expanding.
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
