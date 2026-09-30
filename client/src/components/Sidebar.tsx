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
  // Pin/rename overrides, lifted to CoachPage (one useHistoryOverrides) so ChatSearchOverlay's results agree with this list.
  isPinned: (id: string) => boolean;
  titleFor: (item: HistoryItem) => string;
  pinnedIds: string[];
  togglePin: (id: string) => void;
  rename: (id: string, title: string) => void;
  forget: (id: string) => void;
  // Collapses the sidebar (mobile: closes the drawer; desktop: shrinks to the icon-only rail).
  onClose: () => void;
  // Re-expands from the collapsed desktop rail. Mobile doesn't use it: a closed drawer is off-canvas and its reopen button
  // lives in TopBar (see CoachPage.tsx), since a control inside an off-canvas element can't be reached.
  onOpen: () => void;
  onNewChat: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClearAll: () => void;
  // Toggles ChatSearchOverlay; brand/search/collapse live in this header instead of TopBar, reusing CoachPage's handler.
  onSearchToggle: () => void;
  searchOpen: boolean;
}

const MAX_TITLE_LENGTH = 200;

export default function Sidebar({
  open, items, loading, activeId, isMobile, isPinned, titleFor, pinnedIds, togglePin, rename: renameHistoryItem, forget,
  onClose, onOpen, onNewChat, onSelect, onDelete, onClearAll, onSearchToggle, searchOpen,
}: SidebarProps) {
  const { show } = useToast();

  // Only one row's menu open, and one row renaming, at a time (a per-row popover couldn't guarantee that).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Swipe right-to-left on the open drawer closes it, on top of tap/click/Escape (mobile only; useSidebarSwipe.ts).
  useDrawerSwipeToClose(asideRef, isMobile && open, onClose);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  // Pinned chats float to the top, newest-pinned first, then the server's order (most recent first).
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
    // Reuses ResponseCard's Share mechanism (a wa.me link the teacher reviews and sends), so there's no new way for chat content to leave the app.
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
      {/* aria-hidden only when truly imperceptible: a closed mobile drawer is fully off-canvas, but a collapsed desktop rail
          is on screen and its button is the only way to re-expand it. */}
      <aside ref={asideRef} className={`sidebar${open ? ' sidebar-open' : ''}`} aria-hidden={!open && isMobile}>
        {/* Collapsed desktop rail, hidden via CSS while the sidebar is open (.sidebar-rail-toggle in index.css). Inert on mobile,
            where the aside is off-canvas and reopens from TopBar. */}
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
                  // A <div>, not a <button>, while renaming: an <input> is interactive content a <button> can't contain,
                  // and the row isn't selectable mid-rename anyway.
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

        {/* Fixed at the bottom, below the scrollable history list (.history-list grows to fill the space). Same ProfileMenu state as TopBar. */}
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
