import { useCallback, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { useToast } from '../components/Toast';
import type { HistoryItem } from '../types';

// Rename/pin state for the Coach history sidebar (Sidebar.tsx / HistoryItemMenu.tsx), persisted on the Query row
// (`title`, `pinned`) via PATCH /api/queries/:id, so it survives refreshes and other devices.
// `items` (from CoachPage) is the source of truth; this hook adds a thin optimistic overlay: togglePin/rename apply
// immediately, fire the PATCH in the background and roll back with an error toast on failure. A rename only overrides the
// sidebar label; `item.query`, which selectHistory uses to rebuild the reopened turn, is never touched.

interface Override {
  title?: string;
  pinned?: boolean;
}

export function useHistoryOverrides(items: HistoryItem[]) {
  const { show } = useToast();
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const findItem = useCallback((id: string) => items.find((i) => i.id === id), [items]);

  const isPinned = useCallback(
    (id: string) => overrides[id]?.pinned ?? findItem(id)?.pinned ?? false,
    [overrides, findItem]
  );

  const titleFor = useCallback(
    (item: HistoryItem) => overrides[item.id]?.title ?? item.title ?? item.query,
    [overrides]
  );

  // Derived, not stored; the sidebar only uses it to decide whether pinned items need sorting to the top.
  const pinnedIds = useMemo(
    () => items.filter((item) => isPinned(item.id)).map((item) => item.id),
    [items, isPinned]
  );

  const togglePin = useCallback(async (id: string) => {
    const current = isPinned(id);
    const next = !current;
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], pinned: next } }));
    try {
      await api(`/queries/${id}`, { method: 'PATCH', body: { pinned: next } });
    } catch (err) {
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], pinned: current } }));
      show(err instanceof ApiError ? err.message : 'Could not update pin', 'error');
    }
  }, [isPinned, show]);

  const rename = useCallback(async (id: string, title: string) => {
    const item = findItem(id);
    const previous = item ? titleFor(item) : undefined;
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], title } }));
    try {
      await api(`/queries/${id}`, { method: 'PATCH', body: { title } });
    } catch (err) {
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], title: previous } }));
      show(err instanceof ApiError ? err.message : 'Could not rename chat', 'error');
    }
  }, [findItem, titleFor, show]);

  // Called once an item is deleted, so a stray optimistic override doesn't linger for an id no longer in the list.
  const forget = useCallback((id: string) => {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { isPinned, titleFor, pinnedIds, togglePin, rename, forget };
}
