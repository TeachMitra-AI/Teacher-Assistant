import type { HistoryItem } from '../types';

interface HistoryDrawerProps {
  open: boolean;
  items: HistoryItem[];
  loading: boolean;
  onClose: () => void;
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

export default function HistoryDrawer({ open, items, loading, onClose, onSelect, onDelete, onClearAll }: HistoryDrawerProps) {
  return (
    <>
      <div className={`history-overlay${open ? ' show' : ''}`} onClick={onClose} hidden={!open} />
      <aside className={`history-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="history-drawer-header">
          <span className="drawer-title">🕘 Recent questions</span>
          <div className="history-header-actions">
            {items.length > 0 && (
              <button className="history-clear" onClick={onClearAll} disabled={loading}>
                Clear all
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="history-list">
          {loading && <p className="history-empty">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="history-empty">Your recent questions will appear here.</p>
          )}
          {!loading &&
            items.map((item) => (
              <div key={item.id} className="history-item">
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
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            ))}
        </div>
      </aside>
    </>
  );
}
