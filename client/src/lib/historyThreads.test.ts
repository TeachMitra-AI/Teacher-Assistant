import { describe, expect, it } from 'vitest';
import { groupHistory } from './historyThreads';
import type { HistoryItem } from '../types';

const row = (id: string, conversationId: string | null, extra: Partial<HistoryItem> = {}): HistoryItem => ({
  id, query: `q-${id}`, language: 'en', context: {}, text: `a-${id}`, responseTime: 0,
  createdAt: '2026-01-01T00:00:00Z', rating: null, title: null, pinned: false, conversationId, ...extra,
});

describe('groupHistory', () => {
  it('folds turns of one conversation into one item with a stable id, first question and all turns oldest-first', () => {
    const items = groupHistory([row('3', 'c', { title: 'T', pinned: true }), row('2', 'c'), row('1', 'c')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: '1', query: 'q-1', text: 'a-3', title: 'T', pinned: true, conversationId: 'c' });
    expect(items[0].turns?.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('keeps rows without a conversationId as separate one-turn chats, in recency order', () => {
    const items = groupHistory([row('b', null), row('a', null)]);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(items.every((i) => i.turns?.length === 1)).toBe(true);
  });

  it('merges a pre-thread row with the turns that continued it (its id is their conversationId)', () => {
    const items = groupHistory([row('n2', 'old'), row('n1', 'old'), row('old', null)]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('old');
    expect(items[0].turns?.map((t) => t.id)).toEqual(['old', 'n1', 'n2']);
  });

  it('orders threads by their newest turn', () => {
    const items = groupHistory([row('x2', 'x'), row('y1', 'y'), row('x1', 'x')]);
    expect(items.map((i) => i.conversationId)).toEqual(['x', 'y']);
  });
});
