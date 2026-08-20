// mergeNewNotification is the one piece of real merge logic in
// lib/notifications.ts worth unit-testing in isolation (ported comment from
// client/src/lib/notifications.ts).
import { mergeNewNotification } from '../notifications';
import type { AppNotification } from '../../types';

function notif(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'announcement',
    title: 'Title',
    message: 'Message',
    link: null,
    read: false,
    createdAt: new Date().toISOString(),
    senderName: null,
    senderRole: null,
    metadata: null,
    ...overrides,
  };
}

describe('mergeNewNotification', () => {
  it('prepends a new notification to the front of the list', () => {
    const list = [notif('a'), notif('b')];
    const result = mergeNewNotification(list, notif('c'));
    expect(result.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('replaces a duplicate id in place at the front, never adding a second row', () => {
    const list = [notif('a'), notif('b', { read: false })];
    const result = mergeNewNotification(list, notif('b', { read: true }));
    expect(result.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.find((n) => n.id === 'b')?.read).toBe(true);
  });
});
