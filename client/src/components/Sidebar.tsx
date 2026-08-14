import { Plus, X, Trash2, MessageSquareText } from 'lucide-react';
import type { HistoryItem } from '../types';
import ProfileMenu from './ProfileMenu';

interface SidebarProps {
  open: boolean;
  items: HistoryItem[];
  loading: boolean;
  activeId?: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClearAll: () => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return date.toLocaleDateString();
}

export default function Sidebar({
  open, items, loading, activeId, onClose, onNewChat, onSelect, onDelete, onClearAll,
}: SidebarProps) {
  return (
    <>
      <div className={`sidebar-backdrop${open ? ' show' : ''}`} onClick={onClose} hidden={!open} />
      <aside className={`sidebar${open ? ' sidebar-open' : ''}`} aria-hidden={!open}>
        <div className="sidebar-header">
          <button type="button" className="new-chat-btn" onClick={onNewChat}>
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" /> New chat
          </button>
          <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close sidebar">
            <X size={18} aria-hidden="true" />
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
            items.map((item) => (
              <div key={item.id} className={`history-item${item.id === activeId ? ' active' : ''}`}>
                <button className="history-item-main" onClick={() => onSelect(item)}>
                  <span className="history-query">{item.query}</span>
                  <span className="history-meta">
                    {[item.context.grade, item.context.subject].filter(Boolean).join(' · ')}
                    {(item.context.grade || item.context.subject) && ' • '}
                    {formatTimestamp(item.createdAt)}
                  </span>
                </button>
                <button
                  className="history-delete"
                  onClick={() => onDelete(item)}
                  aria-label="Delete this question"
                  title="Delete"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
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
    </>
  );
}
