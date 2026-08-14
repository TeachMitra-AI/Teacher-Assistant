import { useCallback, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { useToast } from '../components/Toast';
import type { HistoryItem } from '../types';

// Rename/pin state for the Coach history sidebar (see Sidebar.tsx /
// HistoryItemMenu.tsx). Persisted server-side on the Query row itself
// (`title`, `pinned` — server/prisma/schema.prisma) via PATCH
// /api/queries/:id, so a pin or rename survives a refresh, a different
// device, or signing in as the same teacher elsewhere.
//
// `items` (the same array Sidebar already receives from CoachPage) is the
// source of truth for both fields — this hook adds only a thin optimistic
// overlay on top: togglePin/rename apply the change to local state
// immediately, fire the PATCH in the background, and roll the overlay back
// (with an error toast) if the request fails. A successful response needs no
// reconciliation — the value it confirms is exactly what's already showing.
//
// A rename only overrides the SIDEBAR LABEL. `item.query` — the actual
// question text `selectHistory` uses to rebuild the reopened turn — is never
// touched, so renaming cannot corrupt what a reopened conversation shows.

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

  // Derived, not stored: "pinned" always means "isPinned(item.id)" for
  // whichever items currently exist. Sidebar uses this only to decide
  // whether pinned items need sorting to the top at all.
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

  // Called once a history item is actually deleted, so a stray optimistic
  // override can't linger for an id that no longer appears in the list.
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
