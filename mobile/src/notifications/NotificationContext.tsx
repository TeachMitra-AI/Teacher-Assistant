// Ported from client/src/components/Notifications.tsx's NotificationProvider
// (docs/mobile-app-plan.md §15, §26 Phase 7) — same state shape, same
// realtime-connection lifecycle and reconnect-then-refreshUnreadCount()
// correctness backstop (§15's point 2: "covers a notification created while
// the socket was briefly disconnected"). Two deliberate adaptations for
// mobile:
//   1. Mobile has no ToastProvider yet (no prior phase built one) — where the
//      web version calls show() to surface a load/mark-all failure or a
//      realtime arrival as a toast, this exposes an `error` string instead,
//      which NotificationsScreen renders as an inline banner (the same
//      pattern ResourceListScreen already uses for its own load failures).
//      A realtime arrival still updates the list/badge; it just isn't
//      separately announced with a toast.
//   2. This provider is only ever mounted while a user is signed in
//      (RootNavigator wraps MainTabs with it inside the authenticated
//      branch, §26 Phase 3's "no stale screen reachable after logout"
//      structure) rather than globally like the web's App.tsx tree. The
//      `!user` guard below is kept anyway, matching the ported logic exactly
//      and staying defensive if this is ever mounted more broadly later.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';
import { getToken } from '../api/session';
import { Platform } from 'react-native';
import { connectNotificationSocket } from '../lib/socket';
import {
  listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, mergeNewNotification,
  registerDeviceToken,
} from '../api/notifications';
import { registerForPushAsync } from '../lib/push';
import { NOTIFICATIONS_ENABLED, MOBILE_PUSH_ENABLED } from '../config';
import type { AppNotification } from '../types';

interface NotificationContextValue {
  unreadCount: number;
  notifications: AppNotification[];
  loadingList: boolean;
  hasMore: boolean;
  error: string;
  loadFirstPage: () => void;
  loadMore: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');

  const socketRef = useRef<Socket | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await getUnreadCount());
    } catch {
      // A failed count refresh leaves the badge at its last known value —
      // never worth surfacing as an error (same reasoning as the web
      // version).
    }
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const result = await listNotifications(1, 20);
      setNotifications(result.notifications);
      setPage(1);
      setHasMore(result.notifications.length < result.total);
    } catch {
      setError('Could not load notifications. Please try again.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const nextPage = page + 1;
    setLoadingList(true);
    setError('');
    try {
      const result = await listNotifications(nextPage, 20);
      setNotifications((prev) => [...prev, ...result.notifications]);
      setPage(nextPage);
      setHasMore(notifications.length + result.notifications.length < result.total);
    } catch {
      setError('Could not load more notifications. Please try again.');
    } finally {
      setLoadingList(false);
    }
  }, [page, notifications.length]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    markNotificationRead(id).catch(() => {
      // Best-effort: the next loadFirstPage()/refreshUnreadCount() call
      // reconciles any drift from a failed write (same reasoning as web).
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {
      setError('Could not mark all as read. Please try again.');
    });
  }, []);

  // Realtime connection lifecycle: one socket per signed-in session, opened
  // when a user is present AND the feature is on, closed on unmount/logout.
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || !user) return undefined;

    const socket = connectNotificationSocket(getToken);
    socketRef.current = socket;

    // The fallback described in §15: on every (re)connect, re-fetch the
    // authoritative unread count so a notification created while offline/
    // backgrounded is never silently lost. Sockets are the fast path; this
    // is the correctness backstop.
    socket.on('connect', refreshUnreadCount);

    socket.on('notification:new', (incoming: AppNotification) => {
      setNotifications((prev) => mergeNewNotification(prev, incoming));
      setUnreadCount((c) => c + 1);
    });

    // Standard fetch-on-mount pattern — same already-documented case as
    // AuthContext.tsx's mount-restore effect (Phase 3): refreshUnreadCount's
    // own setState calls all happen after its internal `await`s, never
    // synchronously inside this effect body; the lint rule's static check
    // can't see that distinction.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUnreadCount();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Phase 7b: OS-level push registration, same per-signed-in-session
  // lifecycle scope as the socket effect above but a SEPARATE effect — push
  // has no live connection to tear down on sign-out (registering a device
  // token is a one-shot action, not a subscription), and MOBILE_PUSH_ENABLED
  // is a flag independent of NOTIFICATIONS_ENABLED (see config.ts's own
  // comment), so this must not be gated on that flag too. Re-registers on
  // every fresh sign-in, which is also this app's answer to "a token
  // rotated" (§15's "on token-refresh events") — there is no live
  // OS-token-rotation listener (a deliberate scope decision: expo-notifications'
  // addPushTokenListener fires with the underlying native token, not a
  // ready-to-use Expo push token, and its own docs warn against re-deriving
  // one from inside that listener — re-registering on next sign-in is a
  // simple, correct answer to the same rare edge case instead).
  useEffect(() => {
    if (!MOBILE_PUSH_ENABLED || !user) return;

    // No setState involved at all here (registerForPushAsync/registerDeviceToken
    // touch no React state), so unlike the socket effect above this needs no
    // react-hooks/set-state-in-effect suppression.
    registerForPushAsync().then((token) => {
      if (!token) return;
      registerDeviceToken(token, Platform.OS as 'ios' | 'android').catch(() => {
        // Best-effort, matching every other write in this file: a failed
        // registration leaves push simply not delivering to this device
        // until the next sign-in retries it — never worth surfacing as a
        // user-facing error for a background capability.
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo(
    () => ({ unreadCount, notifications, loadingList, hasMore, error, loadFirstPage, loadMore, markRead, markAllRead }),
    [unreadCount, notifications, loadingList, hasMore, error, loadFirstPage, loadMore, markRead, markAllRead]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
