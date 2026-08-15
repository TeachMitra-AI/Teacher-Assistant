import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Search, X } from 'lucide-react';
import type { HistoryItem } from '../types';
import { useDismissable } from '../hooks/useDismissable';
import { formatTimestamp } from '../lib/historyTime';

// The chat-history search overlay behind TopBar's Search icon. Deliberately
// NOT part of Sidebar — it's a floating panel over the main chat column
// (see CoachPage.tsx, which gives .coach-main-chat `position: relative` for
// this to anchor against), matching the Claude-style reference this was
// built from rather than replacing the sidebar's own Recent list.
//
// Client-side only: filters the same `items` array CoachPage already loads
// and passes to Sidebar (`/queries?limit=20`), so results only ever cover
// that already-loaded set, not a teacher's full history. No request is made
// per keystroke, and there is no second copy of history state.

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

  // Same hook the profile menu and other popovers use for Escape/outside-
  // click dismissal — closing this the same way rather than hand-rolling a
  // second copy of that listener pair.
  useDismissable(open, panelRef, onClose);

  // Fresh every time it's opened: autofocus the input, and drop whatever was
  // typed last time so a reopened search never silently starts pre-filtered.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  // Matches the visible title first (so a rename is searchable) and falls
  // back to the original query text (so a renamed chat is still findable by
  // what was actually asked) — titleFor() already does that same fallback
  // for a chat with no custom title, so matching both here just extends it
  // to the renamed case too. Empty query shows the loaded history as-is.
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
    // Close first, open second — same order a teacher sees: the panel goes
    // away and the exact same chat-opening handler Sidebar's own rows use
    // (selectHistory, passed down as onSelect) takes it from there. No
    // separate chat-loading/query-reconstruction logic lives here.
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
