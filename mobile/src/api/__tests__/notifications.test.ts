// mergeNewNotification is the one piece of real merge logic in
// lib/notifications.ts worth unit-testing in isolation (ported comment from
// client/src/lib/notifications.ts). registerDeviceToken/unregisterDeviceToken
// (Phase 7b) get the same request-shape coverage api/resources.test.ts uses
// for its own thin api() wrappers.
import { mergeNewNotification, registerDeviceToken, unregisterDeviceToken } from '../notifications';
import type { AppNotification } from '../../types';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

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

describe('registerDeviceToken / unregisterDeviceToken', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('registerDeviceToken POSTs the token and platform', async () => {
    api.mockResolvedValueOnce({ id: 'dt1' });
    await registerDeviceToken('ExponentPushToken[abc]', 'android');
    expect(api).toHaveBeenCalledWith('/notifications/device-tokens', {
      method: 'POST',
      body: { token: 'ExponentPushToken[abc]', platform: 'android' },
    });
  });

  it('unregisterDeviceToken DELETEs the URL-encoded token', async () => {
    api.mockResolvedValueOnce(undefined);
    await unregisterDeviceToken('ExponentPushToken[has spaces/slash]');
    expect(api).toHaveBeenCalledWith(
      `/notifications/device-tokens/${encodeURIComponent('ExponentPushToken[has spaces/slash]')}`,
      { method: 'DELETE' }
    );
  });
});
