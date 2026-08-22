// Component tests for the Phase 7 Notifications screen (docs/mobile-app-plan.md
// §26 Phase 7 — the native port of Notifications.tsx's NotificationBell
// panel). useNotifications() is module-mocked so each test can drive the
// context's state directly, matching this repo's established convention
// (ResourceListScreen.test.tsx mocks api/resources.ts the same way) —
// NotificationContext's own state machine is covered by
// notifications/__tests__/NotificationContext.test.tsx.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { NotificationsScreen } from '../NotificationsScreen';
import type { AppNotification } from '../../../types';

jest.mock('../../../notifications/NotificationContext', () => ({
  useNotifications: jest.fn(),
}));
const { useNotifications } = jest.requireMock('../../../notifications/NotificationContext') as {
  useNotifications: jest.Mock;
};

function notif(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id, type: 'announcement', title: `Title ${id}`, message: 'A message body', link: null, read: false,
    createdAt: new Date().toISOString(), senderName: null, senderRole: null, metadata: null,
    ...overrides,
  };
}

function makeNavigation() {
  return { navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
}

function ctx(overrides: Partial<ReturnType<typeof baseCtx>> = {}) {
  return { ...baseCtx(), ...overrides };
}

function baseCtx() {
  return {
    unreadCount: 0,
    notifications: [] as AppNotification[],
    loadingList: false,
    hasMore: false,
    error: '',
    loadFirstPage: jest.fn(),
    loadMore: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };
}

function renderScreen(navigation = makeNavigation()) {
  const utils = render(
    <ThemeProvider>
      <NotificationsScreen navigation={navigation as never} route={{ key: 'n', name: 'Notifications', params: undefined } as never} />
    </ThemeProvider>
  );
  return { ...utils, navigation };
}

describe('NotificationsScreen', () => {
  it('calls loadFirstPage on mount', async () => {
    const value = ctx();
    useNotifications.mockReturnValue(value);
    await act(async () => {
      renderScreen();
    });
    expect(value.loadFirstPage).toHaveBeenCalled();
  });

  it('shows a loading state while the first page is in flight with nothing loaded yet', async () => {
    useNotifications.mockReturnValue(ctx({ loadingList: true }));
    await act(async () => {
      renderScreen();
    });
    expect(screen.getByText('Loading notifications…')).toBeTruthy();
  });

  it('shows the empty state once loaded with nothing to show', async () => {
    useNotifications.mockReturnValue(ctx());
    await act(async () => {
      renderScreen();
    });
    expect(screen.getByTestId('notifications-empty-state')).toBeTruthy();
    expect(screen.getByText('You’re all caught up')).toBeTruthy();
  });

  it('renders the list, an unread dot, and a working Mark all read action', async () => {
    const value = ctx({
      unreadCount: 2,
      notifications: [notif('a'), notif('b', { read: true })],
    });
    useNotifications.mockReturnValue(value);
    await act(async () => {
      renderScreen();
    });

    expect(screen.getByTestId('notifications-list')).toBeTruthy();
    expect(screen.getByText('Title a')).toBeTruthy();
    expect(screen.getByText('Title b')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('notifications-mark-all'));
    expect(value.markAllRead).toHaveBeenCalled();
  });

  it('marks an unread notification read on tap but leaves an already-read one alone', async () => {
    const value = ctx({ notifications: [notif('a'), notif('b', { read: true })] });
    useNotifications.mockReturnValue(value);
    await act(async () => {
      renderScreen();
    });

    await fireEvent.press(screen.getByText('Title a'));
    expect(value.markRead).toHaveBeenCalledWith('a');

    value.markRead.mockClear();
    await fireEvent.press(screen.getByText('Title b'));
    expect(value.markRead).not.toHaveBeenCalled();
  });

  it('shows a Load more control when hasMore is true and calls loadMore on tap', async () => {
    const value = ctx({ notifications: [notif('a')], hasMore: true });
    useNotifications.mockReturnValue(value);
    await act(async () => {
      renderScreen();
    });

    const loadMoreBtn = screen.getByTestId('notifications-load-more');
    await fireEvent.press(loadMoreBtn);
    expect(value.loadMore).toHaveBeenCalled();
  });

  it('shows the inline error banner when loading fails', async () => {
    useNotifications.mockReturnValue(ctx({ error: 'Could not load notifications. Please try again.' }));
    await act(async () => {
      renderScreen();
    });
    expect(screen.getByText('Could not load notifications. Please try again.')).toBeTruthy();
  });

  it('reloads on screen focus', async () => {
    const value = ctx();
    useNotifications.mockReturnValue(value);
    const navigation = makeNavigation();
    let focusHandler: (() => void) | undefined;
    (navigation.addListener as jest.Mock).mockImplementation((event: string, cb: () => void) => {
      if (event === 'focus') focusHandler = cb;
      return jest.fn();
    });

    await act(async () => {
      renderScreen(navigation);
    });
    value.loadFirstPage.mockClear();

    await waitFor(() => expect(focusHandler).toBeDefined());
    await act(async () => {
      focusHandler?.();
    });
    expect(value.loadFirstPage).toHaveBeenCalled();
  });
});
