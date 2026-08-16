import { describe, expect, it } from 'vitest';
import { mergeNewNotification } from './notifications';
import type { AppNotification } from '../types';

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'announcement',
    title: 'Title',
    message: 'Message',
    link: null,
    read: false,
    createdAt: new Date().toISOString(),
    senderName: 'Priya',
    senderRole: 'school_admin',
    metadata: null,
    ...overrides,
  };
}

describe('mergeNewNotification', () => {
  it('prepends a new notification onto an empty list', () => {
    const incoming = makeNotification();
    expect(mergeNewNotification([], incoming)).toEqual([incoming]);
  });

  it('prepends onto an existing list, newest first', () => {
    const existing = makeNotification({ id: 'n0' });
    const incoming = makeNotification({ id: 'n1' });
    const result = mergeNewNotification([existing], incoming);
    expect(result.map((n) => n.id)).toEqual(['n1', 'n0']);
  });

  it('replaces a duplicate id in place rather than adding a second row', () => {
    const existing = makeNotification({ id: 'n1', title: 'Old title' });
    const incoming = makeNotification({ id: 'n1', title: 'New title' });
    const result = mergeNewNotification([existing], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('New title');
  });
});
