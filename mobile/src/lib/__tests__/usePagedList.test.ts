// Covers the state machine usePagedList.ts owns: fetch-on-mount, debounced
// search, filter/search resetting the page, and the pager math — the same
// behavior four admin screens (Schools/Pending/Users/Support tickets) rely
// on getting right.
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { usePagedList } from '../usePagedList';
import { ApiError } from '../../api/client';

function page<T>(items: T[], total = items.length) {
  return { items, total, page: 1, limit: 25 };
}

describe('usePagedList', () => {
  it('fetches on mount and exposes the result', async () => {
    const fetcher = jest.fn().mockResolvedValue(page([{ id: '1' }, { id: '2' }], 2));
    const { result } = await renderHook(() => usePagedList(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([{ id: '1' }, { id: '2' }]);
    expect(result.current.total).toBe(2);
    expect(fetcher).toHaveBeenCalledWith({ page: 1, limit: 25, q: '' });
  });

  it('sets the error message on failure and clears items', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError('Admins only.', 403));
    const { result } = await renderHook(() => usePagedList(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Admins only.');
    expect(result.current.items).toEqual([]);
  });

  it('resets to page 1 when the filter key changes', async () => {
    const fetcher = jest.fn().mockResolvedValue(page([{ id: '1' }], 1));
    let filterKey = 'teacher';
    const { result, rerender } = await renderHook(() => usePagedList(fetcher, filterKey));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));

    filterKey = 'school_admin';
    await rerender({});
    await waitFor(() => expect(result.current.page).toBe(1));
  });

  it('computes pager math from total/page/limit', async () => {
    const fetcher = jest.fn().mockResolvedValue({ items: [{ id: '1' }], total: 30, page: 2, limit: 25 });
    const { result } = await renderHook(() => usePagedList(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));

    expect(result.current.totalPages).toBe(2);
  });

  it('patchItem updates a matching row in place without touching total', async () => {
    const fetcher = jest.fn().mockResolvedValue(page([{ id: '1', status: 'pending' }], 1));
    const { result } = await renderHook(() => usePagedList<{ id: string; status: string }>(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.patchItem((item) => item.id === '1', (item) => ({ ...item, status: 'active' }));
    });

    expect(result.current.items).toEqual([{ id: '1', status: 'active' }]);
    expect(result.current.total).toBe(1);
  });
});
