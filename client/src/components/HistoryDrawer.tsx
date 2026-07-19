import type { HistoryItem } from '../types';

interface HistoryDrawerProps {
  open: boolean;
  items: HistoryItem[];
  loading: boolean;
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
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

export default function HistoryDrawer({ open, items, loading, onClose, onSelect }: HistoryDrawerProps) {
  return (
    <>
      <div className={`history-overlay${open ? ' show' : ''}`} onClick={onClose} hidden={!open} />
      <aside className={`history-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="history-drawer-header">
          <span className="drawer-title">🕘 Recent questions</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="history-list">
          {loading && <p className="history-empty">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="history-empty">Your recent questions will appear here.</p>
          )}
          {!loading &&
            items.map((item) => (
              <button key={item.id} className="history-item" onClick={() => onSelect(item)}>
                <span className="history-query">{item.query}</span>
                <span className="history-meta">
                  {[item.context.grade, item.context.subject].filter(Boolean).join(' · ')}
                  {(item.context.grade || item.context.subject) && ' • '}
                  {formatTimestamp(item.createdAt)}
                </span>
              </button>
            ))}
        </div>
      </aside>
    </>
  );
}
