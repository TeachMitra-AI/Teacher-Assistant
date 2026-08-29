// Rename/pin state for the Coach history sidebar (HistorySidebar.tsx) —
// ported from client/src/hooks/useHistoryOverrides.ts. Persisted server-side
// on the Query row itself (`title`, `pinned` — server/prisma/schema.prisma)
// via PATCH /api/queries/:id, so a pin or rename survives a refresh, a
// different device, or signing in as the same teacher elsewhere.
//
// `items` (the same array CoachScreen already loads) is the source of truth
// for both fields — this hook adds only a thin optimistic overlay on top:
// togglePin/rename apply the change to local state immediately, fire the
// PATCH in the background, and roll the overlay back if the request fails.
// No toast on failure — mobile has no toast system (see CoachScreen.tsx's
// handleFeedback, the same silent-rollback precedent); a rename failure is
// visible because the sidebar row snaps back to its previous title.
//
// A rename only overrides the SIDEBAR LABEL. `item.query` — the actual
// question text HistorySidebar's onSelect uses to rebuild the reopened turn
// — is never touched, so renaming cannot corrupt what a reopened
// conversation shows.
import { useCallback, useMemo, useState } from 'react';
import { updateHistoryItem } from '../api/coach';
import type { HistoryItem } from '../types';

interface Override {
  title?: string;
  pinned?: boolean;
}

export function useHistoryOverrides(items: HistoryItem[]) {
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
  // whichever items currently exist.
  const pinnedIds = useMemo(
    () => items.filter((item) => isPinned(item.id)).map((item) => item.id),
    [items, isPinned]
  );

  const togglePin = useCallback(async (id: string) => {
    const current = isPinned(id);
    const next = !current;
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], pinned: next } }));
    try {
      await updateHistoryItem(id, { pinned: next });
    } catch {
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], pinned: current } }));
    }
  }, [isPinned]);

  const rename = useCallback(async (id: string, title: string) => {
    const item = findItem(id);
    const previous = item ? titleFor(item) : undefined;
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], title } }));
    try {
      await updateHistoryItem(id, { title });
    } catch {
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], title: previous } }));
    }
  }, [findItem, titleFor]);

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
