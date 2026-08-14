import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Pencil, Pin, PinOff, Share2, Trash2 } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';

// The three-dot chat-actions menu on each Sidebar history row. Portalled to
// document.body — `.sidebar` has `overflow: hidden` (for its open/close width
// transition) and `.history-list` scrolls, so a plain absolutely-positioned
// popover would be clipped by one or the other; same reasoning
// AttachmentPreviewModal and ConfirmDialog already document for their own
// portals.
//
// Controlled open state (not self-contained like AddMenu/ClassroomModeMenu):
// Sidebar owns a single `openMenuId` so opening one row's menu always closes
// any other, which a self-managed popover per row could not guarantee.

interface Position {
  top?: number;
  bottom?: number;
  right: number;
}

// Only used to decide which way the popover opens, so an approximation is
// enough — see ContextBar's identical reasoning (now TeachingContextMenu).
const POPOVER_APPROX_HEIGHT = 190;

function computePosition(anchorEl: HTMLElement): Position {
  const rect = anchorEl.getBoundingClientRect();
  const right = window.innerWidth - rect.right;
  if (window.innerHeight - rect.bottom < POPOVER_APPROX_HEIGHT) {
    return { bottom: window.innerHeight - rect.top + 6, right };
  }
  return { top: rect.bottom + 6, right };
}

interface HistoryItemMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinned: boolean;
  onRename: () => void;
  onTogglePin: () => void;
  onShare: () => void;
  onDelete: () => void;
}

export default function HistoryItemMenu({
  open, onOpenChange, pinned, onRename, onTogglePin, onShare, onDelete,
}: HistoryItemMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  // Stable identity so useDismissable's effect doesn't tear down/re-attach
  // its listeners on every render — same reasoning as AddMenu/TeachingContextMenu.
  const dismissRefs = useMemo(() => [triggerRef, popoverRef], []);
  useDismissable(open, dismissRefs, () => onOpenChange(false));

  // Re-measured on open, and closed on scroll/resize rather than tracked
  // continuously — the row this button is on can only move by scrolling the
  // history list or resizing the window, and closing on either is simpler and
  // cheaper than a per-frame reposition loop for a menu this short-lived.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }
    setPosition(computePosition(triggerRef.current));
    function close() { onOpenChange(false); }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, onOpenChange]);

  // Portalled to document.body (see above), so this popover is NOT next to
  // its trigger in DOM order — Tab would otherwise skip straight past it to
  // whatever element happens to follow the trigger on the page. Same fix
  // ConfirmDialog already applies to the same problem: focus the first item
  // on open, trap Tab/Shift+Tab within the panel, and hand focus back to the
  // trigger on close.
  //
  // Depends on `position`, not just `open`: on the render where `open` first
  // becomes true, `position` is still null (the layout effect above hasn't
  // measured yet), so the portal hasn't rendered and popoverRef.current is
  // still null — focusing here would silently no-op. `position` flips from
  // null to a value one render later, which is what this needs to wait for.
  useEffect(() => {
    if (!open || !position) return;
    const firstItem = popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
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
  }, [open]);

  return (
    <div className="history-item-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`history-item-menu-btn${open ? ' active' : ''}`}
        // Stops the click from also bubbling up into the history-item-main
        // button and opening the chat — the two controls sit right next to
        // each other in the same row.
        onClick={(e) => { e.stopPropagation(); onOpenChange(!open); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chat actions"
        title="Chat actions"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div
          ref={popoverRef}
          className="history-item-menu-popover"
          role="menu"
          aria-label="Chat actions"
          style={{
            top: position.top ?? 'auto',
            bottom: position.bottom ?? 'auto',
            right: position.right,
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="history-item-menu-item"
            onClick={() => { onOpenChange(false); onRename(); }}
          >
            <Pencil size={15} aria-hidden="true" /> Rename chat
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-item-menu-item"
            onClick={() => { onOpenChange(false); onTogglePin(); }}
          >
            {pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
            {pinned ? 'Unpin chat' : 'Pin chat'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-item-menu-item"
            onClick={() => { onOpenChange(false); onShare(); }}
          >
            <Share2 size={15} aria-hidden="true" /> Share chat
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-item-menu-item danger"
            onClick={() => { onOpenChange(false); onDelete(); }}
          >
            <Trash2 size={15} aria-hidden="true" /> Delete chat
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
