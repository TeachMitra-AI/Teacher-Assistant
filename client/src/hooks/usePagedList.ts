// Shared state for a server-paginated, searchable, filterable admin table. Extracted because the Manage page has three;
// each needs a debounced search, a page that resets when the query changes, protection from out-of-date responses, a
// total for the "showing X–Y of N" label, and a refetch after a mutation.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import type { Paged } from '../lib/admin';

export const DEFAULT_PAGE_SIZE = 25;

// Matches LibraryPage's search debounce, so neither fires a request per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

export interface PagedList<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string;
  /** Raw search text; bind it to the input's value. */
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
   * Patches one visible row for instant feedback. Doesn't adjust `total` or page boundaries, so always follow it with
   * refetch(); that's why it isn't a general-purpose setter.
   */
  patchItem: (match: (item: T) => boolean, update: (item: T) => T) => void;
}

/**
 * @param fetcher  Called with the current page/search. Must be memoized by the caller (useCallback); it's a dependency of the fetch.
 * @param filterKey Serialized filter state (e.g. `${role}|${status}`). Any change resets to page 1, since page 7 of the
 *                 previous result set means nothing in the new one.
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

  // Narrowing the list invalidates the page number: page 4 of a two-row search looks like "no results".
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterKey]);

  // Monotonic request id: responses can arrive out of order, so only the newest request may write state.
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
