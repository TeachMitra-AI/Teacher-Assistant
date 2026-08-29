// Native port of client/src/hooks/usePagedList.ts — identical state machine
// (debounced search, filter-resets-page, out-of-order-response guard,
// pager math, patchItem for optimistic row updates). Extracted rather than
// duplicated because the Manage tab has three such tables (Schools, Pending
// teachers, Users) and Support has a fourth (tickets) — each needs the same
// five things, and each gets them wrong in the same way if hand-rolled.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import type { Paged } from '../api/admin';

export const DEFAULT_PAGE_SIZE = 25;

// Matches ResourceListScreen's search debounce, so typing in either place
// feels the same and neither fires a request per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

export interface PagedList<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string;
  /** Raw search text — bind straight to the input's value. */
  search: string;
  setSearch: (value: string) => void;
  /** True once a search or filter is narrowing the list. */
  isFiltering: boolean;
  setPage: (page: number) => void;
  /** 1-indexed, always >= 1 even when the list is empty. */
  totalPages: number;
  /** Inclusive 1-indexed range of the current page, for the count label. */
  rangeStart: number;
  rangeEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Re-run the current page. Use after a mutation. */
  refetch: () => Promise<void>;
  /**
   * Patch one already-visible row for instant feedback. Does NOT adjust
   * `total` or page boundaries — always follow it with refetch(), which is
   * why this is deliberately not a general-purpose setter.
   */
  patchItem: (match: (item: T) => boolean, update: (item: T) => T) => void;
}

/**
 * @param fetcher  Called with the current page/search. Must be memoized by the
 *                 caller (useCallback) — it is a dependency of the fetch.
 * @param filterKey Serialized filter state (e.g. `${role}|${status}`). Any
 *                 change resets to page 1, since page 7 of the previous
 *                 result set means nothing in the new one.
 */
export function usePagedList<T>(
  fetcher: (args: { page: number; limit: number; q: string }) => Promise<Paged<T>>,
  filterKey = '',
  limit = DEFAULT_PAGE_SIZE
): PagedList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Narrowing the list invalidates the page number: if you are on page 4 and
  // type a search that matches two rows, page 4 is empty and looks like "no
  // results" instead of showing the two matches. Resetting page as a
  // side effect of a filter change (rather than deriving it) is the
  // deliberate choice here — see AuthContext.tsx's identical, already-
  // documented case for why this synchronous setState is unavoidable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedSearch, filterKey]);

  // Monotonic request id. Responses can arrive out of order — a slow page 1
  // landing after a fast page 2 would otherwise show page 1's rows while the
  // pager reads "page 2". Only the newest request may write state.
  const requestId = useRef(0);

  const runFetch = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError('');
    try {
      const result = await fetcher({ page, limit, q: debouncedSearch });
      if (requestId.current !== id) return;
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      if (requestId.current !== id) return;
      setError(err instanceof ApiError ? err.message : 'Could not load this list.');
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [fetcher, page, limit, debouncedSearch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runFetch();
  }, [runFetch]);

  const patchItem = useCallback((match: (item: T) => boolean, update: (item: T) => T) => {
    setItems((list) => list.map((item) => (match(item) ? update(item) : item)));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(page * limit, total);

  return {
    items,
    total,
    page,
    limit,
    loading,
    error,
    search,
    setSearch,
    isFiltering: debouncedSearch !== '' || filterKey !== '',
    setPage,
    totalPages,
    rangeStart,
    rangeEnd,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    refetch: runFetch,
    patchItem,
  };
}
