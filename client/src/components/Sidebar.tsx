import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, PanelLeft, Search, MessageSquareText, Pin } from 'lucide-react';
import type { HistoryItem } from '../types';
import ProfileMenu from './ProfileMenu';
import HistoryItemMenu from './HistoryItemMenu';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './Toast';
import { useDrawerSwipeToClose } from '../hooks/useSidebarSwipe';
import { formatTimestamp } from '../lib/historyTime';

interface SidebarProps {
  open: boolean;
  items: HistoryItem[];
  loading: boolean;
  activeId?: string | null;
  isMobile: boolean;
  // Pin/rename overrides — lifted up to CoachPage (one useHistoryOverrides
  // instance) rather than called here, so ChatSearchOverlay's results agree
  // with this list instead of keeping a second, disagreeing set of overrides.
  isPinned: (id: string) => boolean;
  titleFor: (item: HistoryItem) => string;
  pinnedIds: string[];
  togglePin: (id: string) => void;
  rename: (id: string, title: string) => void;
  forget: (id: string) => void;
  // Collapses the sidebar (mobile: closes the drawer; desktop: shrinks to the
  // icon-only rail — see .sidebar-rail-toggle below).
  onClose: () => void;
  // Re-expands the sidebar from its collapsed desktop rail. Mobile has no use
  // for this — a closed drawer is off-canvas, and the button that reopens it
  // lives in TopBar instead (see CoachPage.tsx), since a control inside an
  // off-canvas element can't be reached.
  onOpen: () => void;
  onNewChat: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClearAll: () => void;
  // Toggles ChatSearchOverlay — brand/search/collapse now live together in
  // this component's header (see .sidebar-brand-row) instead of TopBar, so
  // this reuses the exact same handler CoachPage always owned rather than a
  // second search implementation.
  onSearchToggle: () => void;
  searchOpen: boolean;
}

const MAX_TITLE_LENGTH = 200;

export default function Sidebar({
  open, items, loading, activeId, isMobile, isPinned, titleFor, pinnedIds, togglePin, rename: renameHistoryItem, forget,
  onClose, onOpen, onNewChat, onSelect, onDelete, onClearAll, onSearchToggle, searchOpen,
}: SidebarProps) {
  const { show } = useToast();

  // Only one row's menu open at a time (a self-managed popover per row could
  // not guarantee that), and only one row renaming at a time.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Additional gesture on top of the existing tap/click/Escape controls —
  // swipe right-to-left on the open drawer to close it (mobile only; see
  // useSidebarSwipe.ts). Desktop's inline sidebar is untouched.
  useDrawerSwipeToClose(asideRef, isMobile && open, onClose);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  // Pinned chats float to the top, newest-pinned first, then everything else
  // in the order the server already returns (most recent first) — reordering
  // is the whole point of a pin, but nothing else about the list's order
  // changes.
  const sortedItems = useMemo(() => {
    if (pinnedIds.length === 0) return items;
    return [...items].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)));
  }, [items, pinnedIds, isPinned]);

  function startRename(item: HistoryItem) {
    setRenamingId(item.id);
    setRenameDraft(titleFor(item));
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  function commitRename(item: HistoryItem) {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      show('Please enter a title', 'error');
      return;
    }
    renameHistoryItem(item.id, trimmed.slice(0, MAX_TITLE_LENGTH));
    setRenamingId(null);
    setRenameDraft('');
  }

  function shareChat(item: HistoryItem) {
    // Same mechanism ResponseCard's "Share" action already uses (a wa.me
    // compose link the teacher reviews and sends themselves) — reused rather
    // than a new sharing architecture, so there is no new way for chat
    // content to leave the app unintentionally.
    const text = `${titleFor(item)}\n\n${item.text}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    onDelete(pendingDelete);
    forget(pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <>
      <div className={`sidebar-backdrop${open ? ' show' : ''}`} onClick={onClose} hidden={!open} />
      {/* aria-hidden only when truly imperceptible: a closed MOBILE drawer is
          translated fully off-canvas, but a collapsed DESKTOP rail is still
          on screen and its one button (below) is the only way to re-expand
          it — hiding that from assistive tech would strand it. */}
      <aside ref={asideRef} className={`sidebar${open ? ' sidebar-open' : ''}`} aria-hidden={!open && isMobile}>
        {/* Collapsed desktop rail — hidden via CSS whenever the sidebar is
            open (see .sidebar-rail-toggle in index.css). On mobile the whole
            aside is off-canvas while closed, so this is inert there; the
            drawer's own open control lives in TopBar instead (see
            CoachPage.tsx). */}
        <button
          type="button"
          className="icon-btn sidebar-rail-toggle"
          onClick={onOpen}
          aria-label="Expand sidebar"
        >
          <PanelLeft size={18} aria-hidden="true" />
        </button>

        <div className="sidebar-brand-row">
          <Link to="/" className="brand" aria-label="SarasTech — home">
            <img src="/logo.png" alt="" className="brand-logo" aria-hidden="true" />
            <span className="brand-text">
              <strong className="brand-title">SarasTech</strong>
              <span className="brand-sub">Teacher Assistant</span>
            </span>
          </Link>
          <div className="sidebar-brand-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={onSearchToggle}
              title="Search chats"
              aria-label="Search chats"
              aria-pressed={searchOpen}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn sidebar-close"
              onClick={onClose}
              aria-label={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
            >
              {isMobile ? <X size={18} aria-hidden="true" /> : <PanelLeft size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="sidebar-header">
          <button type="button" className="new-chat-btn" onClick={onNewChat}>
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" /> New chat
          </button>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-section-label">Recent</span>
          {items.length > 0 && (
            <button type="button" className="history-clear" onClick={onClearAll} disabled={loading}>
              Clear all
            </button>
          )}
        </div>

        <div className="history-list">
          {loading && <p className="history-empty">Loading…</p>}
          {!loading && items.length === 0 && (
            <div className="history-empty-state">
              <span className="history-empty-icon" aria-hidden="true">
                <MessageSquareText size={22} strokeWidth={1.8} />
              </span>
              <p className="history-empty-title">No conversations yet</p>
              <p className="history-empty-hint">Your recent questions will appear here.</p>
              <button type="button" className="history-empty-cta" onClick={onNewChat}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> Start a chat
              </button>
            </div>
          )}
          {!loading &&
            sortedItems.map((item) => (
              <div key={item.id} className={`history-item${item.id === activeId ? ' active' : ''}`}>
                {renamingId === item.id ? (
                  // A <div>, not a <button>, while renaming: an <input> is
                  // interactive content, which a <button> may never contain
                  // (invalid HTML, and unreliable focus/typing in practice).
                  // The row isn't selectable mid-rename anyway, so a button's
                  // semantics don't belong here for these few moments.
                  <div className="history-item-main">
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="history-rename-input"
                      value={renameDraft}
                      maxLength={MAX_TITLE_LENGTH}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(item); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                      }}
                      aria-label="Chat title"
                    />
                    <span className="history-meta">
                      {[item.context.grade, item.context.subject].filter(Boolean).join(' · ')}
                      {(item.context.grade || item.context.subject) && ' • '}
                      {formatTimestamp(item.createdAt)}
                    </span>
                  </div>
                ) : (
                  <button className="history-item-main" onClick={() => onSelect(item)}>
                    <span className="history-query-row">
                      {isPinned(item.id) && (
                        <Pin size={12} className="history-pin-icon" aria-hidden="true" />
                      )}
                      <span className="history-query">{titleFor(item)}</span>
                    </span>
                    <span className="history-meta">
                      {[item.context.grade, item.context.subject].filter(Boolean).join(' · ')}
                      {(item.context.grade || item.context.subject) && ' • '}
                      {formatTimestamp(item.createdAt)}
                    </span>
                  </button>
                )}
                <HistoryItemMenu
                  open={openMenuId === item.id}
                  onOpenChange={(next) => setOpenMenuId(next ? item.id : null)}
                  pinned={isPinned(item.id)}
                  onRename={() => startRename(item)}
                  onTogglePin={() => togglePin(item.id)}
                  onShare={() => shareChat(item)}
                  onDelete={() => setPendingDelete(item)}
                />
              </div>
            ))}
        </div>

        {/* Fixed at the bottom, below the independently-scrollable history
            list above (.history-list has its own overflow-y and flex: 1, so
            it grows to fill the remaining space and this footer never moves).
            Same ProfileMenu/account-menu state TopBar uses everywhere else —
            see ProfileMenu.tsx. */}
        <div className="sidebar-footer">
          <ProfileMenu variant="sidebar" />
        </div>
      </aside>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this chat?"
        body={pendingDelete ? `"${titleFor(pendingDelete)}" will be permanently removed. This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
