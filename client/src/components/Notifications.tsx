import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../auth';
import { useToast } from './Toast';
import { useDismissable } from '../hooks/useDismissable';
import { getToken } from '../api';
import { connectNotificationSocket } from '../lib/socket';
import {
  listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, mergeNewNotification,
} from '../lib/notifications';
import { formatTimestamp } from '../lib/historyTime';
import { NOTIFICATIONS_ENABLED, NOTIFICATION_TYPE_META } from '../config';
import type { AppNotification } from '../types';

// Notification System — see docs/notification-system-plan.md. One globally
// mounted provider (same "provider owns its own state" shape as
// ToastProvider/HelpSupportProvider) so the unread badge and the realtime
// socket connection live for the whole authenticated session, not just while
// the bell's dropdown happens to be open. NotificationBell (rendered once,
// in TopBar.tsx) is the only consumer of useNotifications() today.

interface NotificationContextValue {
  unreadCount: number;
  notifications: AppNotification[];
  loadingList: boolean;
  hasMore: boolean;
  loadFirstPage: () => void;
  loadMore: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { show } = useToast();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const socketRef = useRef<Socket | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await getUnreadCount());
    } catch {
      // A failed count refresh leaves the badge at its last known value —
      // never worth surfacing to the teacher as an error.
    }
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await listNotifications(1, 20);
      setNotifications(result.notifications);
      setPage(1);
      setHasMore(result.notifications.length < result.total);
    } catch {
      show('Could not load notifications. Please try again.', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [show]);

  const loadMore = useCallback(async () => {
    const nextPage = page + 1;
    setLoadingList(true);
    try {
      const result = await listNotifications(nextPage, 20);
      setNotifications((prev) => [...prev, ...result.notifications]);
      setPage(nextPage);
      setHasMore(notifications.length + result.notifications.length < result.total);
    } catch {
      show('Could not load more notifications. Please try again.', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [page, notifications.length, show]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    markNotificationRead(id).catch(() => {
      // Best-effort: the next loadFirstPage()/refreshUnreadCount() call
      // (e.g. the panel reopening) reconciles any drift from a failed write.
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {
      show('Could not mark all as read. Please try again.', 'error');
    });
  }, [show]);

  // Realtime connection lifecycle: one socket per signed-in session, opened
  // when a user is present AND the feature is on, closed on logout. Never
  // opened for a signed-out visitor.
  useEffect(() => {
    if (!NOTIFICATIONS_ENABLED || !user) return undefined;

    const socket = connectNotificationSocket(getToken);
    socketRef.current = socket;

    // The fallback described in docs/notification-system-plan.md §5: on
    // every (re)connect, re-fetch the authoritative unread count so a
    // notification created while this tab was offline/backgrounded is never
    // silently lost. Sockets are the fast path; this is the correctness
    // backstop.
    socket.on('connect', refreshUnreadCount);

    socket.on('notification:new', (incoming: AppNotification) => {
      setNotifications((prev) => mergeNewNotification(prev, incoming));
      setUnreadCount((c) => c + 1);
      show(incoming.title, 'info');
    });

    refreshUnreadCount();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo(
    () => ({ unreadCount, notifications, loadingList, hasMore, loadFirstPage, loadMore, markRead, markAllRead }),
    [unreadCount, notifications, loadingList, hasMore, loadFirstPage, loadMore, markRead, markAllRead]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

// ---- Bell + panel -----------------------------------------------------------

export default function NotificationBell() {
  const { unreadCount, notifications, loadingList, hasMore, loadFirstPage, loadMore, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismissable(open, wrapRef, () => setOpen(false));

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadFirstPage();
  }

  function handleRowClick(n: AppNotification) {
    if (!n.read) markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn notif-bell-btn"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="notif-badge" aria-hidden="true">{badgeLabel}</span>}
      </button>

      {open && (
        <div className="notif-overlay show" onClick={() => setOpen(false)} aria-hidden="true">
          <div
            className="notif-panel"
            role="dialog"
            aria-label="Notifications"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="notif-panel-head">
              <h2 className="notif-panel-title">Notifications</h2>
              {unreadCount > 0 && (
                <button type="button" className="notif-mark-all" onClick={markAllRead}>
                  <CheckCheck size={14} aria-hidden="true" /> Mark all read
                </button>
              )}
            </div>

            {loadingList && notifications.length === 0 && (
              <div className="notif-loading">
                <div className="sk-line" />
                <div className="sk-line" />
                <div className="sk-line" />
              </div>
            )}

            {!loadingList && notifications.length === 0 && (
              <div className="notif-empty">
                <Bell size={28} aria-hidden="true" />
                <p>You&rsquo;re all caught up</p>
              </div>
            )}

            {notifications.length > 0 && (
              <ul className="notif-list">
                {notifications.map((n) => {
                  const meta = NOTIFICATION_TYPE_META[n.type];
                  const Icon = meta?.icon || Bell;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`notif-row${n.read ? '' : ' notif-row-unread'}`}
                        onClick={() => handleRowClick(n)}
                      >
                        <span className="notif-row-icon" aria-hidden="true"><Icon size={16} /></span>
                        <span className="notif-row-body">
                          <span className="notif-row-title">{n.title}</span>
                          <span className="notif-row-message">{n.message}</span>
                          <span className="notif-row-time">{formatTimestamp(n.createdAt)}</span>
                        </span>
                        {!n.read && <span className="notif-row-dot" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasMore && notifications.length > 0 && (
              <button type="button" className="notif-load-more" onClick={loadMore} disabled={loadingList}>
                {loadingList ? <Loader2 size={14} className="spin" aria-hidden="true" /> : 'Load more'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
