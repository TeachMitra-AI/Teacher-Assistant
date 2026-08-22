// Tests for NotificationProvider (docs/mobile-app-plan.md §15, §26 Phase 7)
// — the state machine behind the badge/list, ported from
// client/src/components/Notifications.tsx's NotificationProvider. A tiny
// consumer component exposes the context's values as text/buttons since a
// Context provider has nothing to render-assert against on its own (same
// approach client-side tests for provider-only modules would use).
import React from 'react';
import { Text, Pressable } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { NotificationProvider, useNotifications } from '../NotificationContext';
import type { AppNotification } from '../../types';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  NOTIFICATIONS_ENABLED: true,
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Demo Teacher' } }),
}));

jest.mock('../../api/session', () => ({
  getToken: jest.fn().mockResolvedValue('tok'),
}));

jest.mock('../../api/notifications', () => {
  const actual = jest.requireActual('../../api/notifications');
  return {
    ...actual,
    listNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
  };
});

const {
  listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
} = jest.requireMock('../../api/notifications') as {
  listNotifications: jest.Mock; getUnreadCount: jest.Mock; markNotificationRead: jest.Mock; markAllNotificationsRead: jest.Mock;
};

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

type Listener = (...args: unknown[]) => void;

function createFakeSocket() {
  const listeners: Record<string, Listener[]> = {};
  return {
    on: jest.fn((event: string, cb: Listener) => {
      (listeners[event] ||= []).push(cb);
    }),
    off: jest.fn(),
    disconnect: jest.fn(),
    emitFake(event: string, ...args: unknown[]) {
      (listeners[event] || []).forEach((cb) => cb(...args));
    },
  };
}

function notif(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id, type: 'announcement', title: `Title ${id}`, message: 'Message', link: null, read: false,
    createdAt: new Date().toISOString(), senderName: null, senderRole: null, metadata: null,
    ...overrides,
  };
}

function Consumer() {
  const { unreadCount, notifications, loadingList, hasMore, error, loadFirstPage, loadMore, markRead, markAllRead } =
    useNotifications();
  return (
    <>
      <Text testID="unread">{unreadCount}</Text>
      <Text testID="count">{notifications.length}</Text>
      <Text testID="loading">{String(loadingList)}</Text>
      <Text testID="hasMore">{String(hasMore)}</Text>
      <Text testID="error">{error}</Text>
      {notifications.map((n) => (
        <Text key={n.id} testID={`n-${n.id}`}>{n.read ? 'read' : 'unread'}</Text>
      ))}
      <Pressable testID="load-first" onPress={() => loadFirstPage()} />
      <Pressable testID="load-more" onPress={() => loadMore()} />
      <Pressable testID="mark-a" onPress={() => markRead('a')} />
      <Pressable testID="mark-all" onPress={() => markAllRead()} />
    </>
  );
}

async function renderProvider() {
  return render(
    <NotificationProvider>
      <Consumer />
    </NotificationProvider>
  );
}

describe('NotificationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUnreadCount.mockResolvedValue(0);
    // Default fake socket for tests that don't care about socket behavior
    // directly — otherwise the mocked `io()` returns undefined and the
    // effect's own socket.on(...) calls throw.
    (io as jest.Mock).mockReturnValue(createFakeSocket());
  });

  it('loads the first page and reports total/hasMore', async () => {
    listNotifications.mockResolvedValueOnce({ notifications: [notif('a'), notif('b')], total: 5, page: 1, limit: 20 });
    await renderProvider();

    await fireEvent.press(screen.getByTestId('load-first'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('hasMore')).toHaveTextContent('true');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('sets an error message when the first page fails to load', async () => {
    listNotifications.mockRejectedValueOnce(new Error('network'));
    await renderProvider();

    await fireEvent.press(screen.getByTestId('load-first'));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Could not load notifications. Please try again.'));
  });

  it('appends the next page on loadMore', async () => {
    listNotifications.mockResolvedValueOnce({ notifications: [notif('a')], total: 2, page: 1, limit: 1 });
    await renderProvider();
    await fireEvent.press(screen.getByTestId('load-first'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    listNotifications.mockResolvedValueOnce({ notifications: [notif('b')], total: 2, page: 2, limit: 1 });
    await fireEvent.press(screen.getByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('hasMore')).toHaveTextContent('false');
  });

  it('marks a single notification read optimistically and decrements the badge', async () => {
    listNotifications.mockResolvedValueOnce({ notifications: [notif('a')], total: 1, page: 1, limit: 20 });
    getUnreadCount.mockResolvedValue(1);
    markNotificationRead.mockResolvedValue(undefined);
    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    await fireEvent.press(screen.getByTestId('load-first'));
    await waitFor(() => expect(screen.getByTestId('n-a')).toHaveTextContent('unread'));

    await fireEvent.press(screen.getByTestId('mark-a'));
    expect(screen.getByTestId('n-a')).toHaveTextContent('read');
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
    expect(markNotificationRead).toHaveBeenCalledWith('a');
  });

  it('marks all read optimistically and surfaces an error on failure without reverting', async () => {
    getUnreadCount.mockResolvedValue(3);
    markAllNotificationsRead.mockRejectedValue(new Error('down'));
    await renderProvider();
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('3'));

    await fireEvent.press(screen.getByTestId('mark-all'));
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Could not mark all as read. Please try again.'));
  });

  it('opens a socket, runs the reconnect-then-refresh backstop, and merges a realtime arrival', async () => {
    const fakeSocket = createFakeSocket();
    (io as jest.Mock).mockReturnValue(fakeSocket);
    getUnreadCount.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await renderProvider();

    // Immediate refreshUnreadCount() on mount (the fast path).
    await waitFor(() => expect(getUnreadCount).toHaveBeenCalledTimes(1));

    // Reconnect backstop: a 'connect' event re-fetches the authoritative count.
    await act(async () => {
      fakeSocket.emitFake('connect');
    });
    await waitFor(() => expect(getUnreadCount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));

    // A realtime arrival prepends to the list and increments the badge.
    await act(async () => {
      fakeSocket.emitFake('notification:new', notif('z'));
    });
    expect(screen.getByTestId('unread')).toHaveTextContent('3');
    expect(screen.getByTestId('n-z')).toHaveTextContent('unread');

    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the socket on unmount', async () => {
    const fakeSocket = createFakeSocket();
    (io as jest.Mock).mockReturnValue(fakeSocket);
    const view = await renderProvider();
    await waitFor(() => expect(getUnreadCount).toHaveBeenCalled());

    await act(async () => {
      view.unmount();
    });
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });
});
