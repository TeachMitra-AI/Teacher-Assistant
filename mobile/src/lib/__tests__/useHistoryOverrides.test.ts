// Coverage for useHistoryOverrides.ts's optimistic pin/rename overlay
// (ported from client/src/hooks/useHistoryOverrides.ts) — updateHistoryItem
// (api/coach.ts) is mocked here; its own request shape is covered by
// api/__tests__/coach.test.ts.
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useHistoryOverrides } from '../useHistoryOverrides';
import type { HistoryItem } from '../../types';

jest.mock('../../api/coach', () => ({ updateHistoryItem: jest.fn() }));
const { updateHistoryItem } = jest.requireMock('../../api/coach') as { updateHistoryItem: jest.Mock };

const ITEM: HistoryItem = {
  id: 'q1', query: 'How do I teach fractions?', language: 'en', context: {},
  text: 'Start with physical objects.', responseTime: 500,
  createdAt: '2026-08-28T00:00:00.000Z', rating: null, title: null, pinned: false,
};

describe('useHistoryOverrides', () => {
  beforeEach(() => {
    updateHistoryItem.mockReset();
  });

  it('falls back to the item itself when there is no override yet', async () => {
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));
    expect(result.current.isPinned('q1')).toBe(false);
    expect(result.current.titleFor(ITEM)).toBe('How do I teach fractions?');
    expect(result.current.pinnedIds).toEqual([]);
  });

  it('titleFor prefers a set title over the raw query', async () => {
    const titled: HistoryItem = { ...ITEM, title: 'Fractions lesson' };
    const { result } = await renderHook(() => useHistoryOverrides([titled]));
    expect(result.current.titleFor(titled)).toBe('Fractions lesson');
  });

  it('togglePin applies optimistically and persists via updateHistoryItem', async () => {
    updateHistoryItem.mockResolvedValueOnce(undefined);
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));

    await act(async () => {
      await result.current.togglePin('q1');
    });

    expect(result.current.isPinned('q1')).toBe(true);
    expect(result.current.pinnedIds).toEqual(['q1']);
    expect(updateHistoryItem).toHaveBeenCalledWith('q1', { pinned: true });
  });

  it('togglePin rolls back on a failed request', async () => {
    updateHistoryItem.mockRejectedValueOnce(new Error('network error'));
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));

    await act(async () => {
      await result.current.togglePin('q1');
    });

    expect(result.current.isPinned('q1')).toBe(false);
  });

  it('rename applies optimistically and persists via updateHistoryItem', async () => {
    updateHistoryItem.mockResolvedValueOnce(undefined);
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));

    await act(async () => {
      await result.current.rename('q1', 'Fractions lesson');
    });

    expect(result.current.titleFor(ITEM)).toBe('Fractions lesson');
    expect(updateHistoryItem).toHaveBeenCalledWith('q1', { title: 'Fractions lesson' });
  });

  it('rename rolls back to the previous title on a failed request', async () => {
    updateHistoryItem.mockRejectedValueOnce(new Error('network error'));
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));

    await act(async () => {
      await result.current.rename('q1', 'Fractions lesson');
    });

    await waitFor(() => expect(result.current.titleFor(ITEM)).toBe('How do I teach fractions?'));
  });

  it('forget clears a stray override for an id that no longer exists', async () => {
    updateHistoryItem.mockResolvedValueOnce(undefined);
    const { result } = await renderHook(() => useHistoryOverrides([ITEM]));

    await act(async () => {
      await result.current.togglePin('q1');
    });
    expect(result.current.isPinned('q1')).toBe(true);

    await act(async () => {
      result.current.forget('q1');
    });
    // The override is gone; isPinned falls back to the item's own (still
    // unpinned) `pinned` field, not any lingering override.
    await waitFor(() => expect(result.current.isPinned('q1')).toBe(false));
  });
});
