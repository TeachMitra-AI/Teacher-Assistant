import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Search, X } from 'lucide-react';
import type { HistoryItem } from '../types';
import { useDismissable } from '../hooks/useDismissable';
import { formatTimestamp } from '../lib/historyTime';

// The chat-history search overlay behind TopBar's Search icon: a floating panel over the main chat column (CoachPage gives
// .coach-main-chat `position: relative` for it), not part of Sidebar. Client-side only: it filters the `items` CoachPage
// already loads for Sidebar (`/queries?limit=20`), so results cover only that set, no request per keystroke and no second
// copy of history state.

interface ChatSearchOverlayProps {
  open: boolean;
  items: HistoryItem[];
  titleFor: (item: HistoryItem) => string;
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
}

export default function ChatSearchOverlay({ open, items, titleFor, onClose, onSelect }: ChatSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same Escape/outside-click hook as the other popovers, instead of a second copy of that listener pair.
  useDismissable(open, panelRef, onClose);

  // Fresh on every open: autofocus the input and drop the last query so a reopened search doesn't start pre-filtered.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  // Matches the visible title first (so a rename is searchable), then the original query text (so a renamed chat is still
  // found by what was asked). An empty query shows the loaded history as-is.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const title = titleFor(item).toLowerCase();
      const text = item.query.toLowerCase();
      return title.includes(q) || text.includes(q);
    });
  }, [items, query, titleFor]);

  if (!open) return null;

  function handleSelect(item: HistoryItem) {
    // Close first, then hand off to the same chat-opening handler Sidebar's rows use (selectHistory via onSelect); no
    // separate chat-loading logic lives here.
    onClose();
    onSelect(item);
  }

  return (
    <div className="chat-search-overlay">
      <div ref={panelRef} className="chat-search-panel" role="dialog" aria-modal="true" aria-label="Search chats">
        <div className="chat-search-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
          />
          <button type="button" className="chat-search-close" onClick={onClose} aria-label="Close search" title="Close search">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {results.length === 0 ? (
          <div className="chat-search-empty">
            <Search size={20} strokeWidth={1.8} aria-hidden="true" />
            <p>{query.trim() ? 'No chats found' : 'No conversations yet'}</p>
          </div>
        ) : (
          <ul className="chat-search-results">
            {results.map((item) => (
              <li key={item.id}>
                <button type="button" className="chat-search-result" onClick={() => handleSelect(item)}>
                  <MessageSquareText size={16} className="chat-search-result-icon" aria-hidden="true" />
                  <span className="chat-search-result-title">{titleFor(item)}</span>
                  <span className="chat-search-result-time">{formatTimestamp(item.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
