// Typed client for the Notification API. Thin wrapper over api(), same shape
// as lib/support.ts — pages/components don't hand-build the request.
import { api } from '../api';
import type { AppNotification, SendNotificationInput } from '../types';

export interface NotificationPage {
  notifications: AppNotification[];
  total: number;
  page: number;
  limit: number;
}

export async function listNotifications(page = 1, limit = 20): Promise<NotificationPage> {
  return api<NotificationPage>(`/notifications?page=${page}&limit=${limit}`);
}

export async function getUnreadCount(): Promise<number> {
  const data = await api<{ count: number }>('/notifications/unread-count');
  return data.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api(`/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<number> {
  const data = await api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });
  return data.updated;
}

export async function sendNotification(input: SendNotificationInput): Promise<{ recipientCount: number }> {
  return api<{ success: boolean; recipientCount: number }>('/notifications', { method: 'POST', body: input });
}

/**
 * Prepends a realtime-delivered notification (Socket.IO 'notification:new')
 * onto the cached list, deduping by id. Factored out as a pure function so
 * components/Notifications.tsx's provider stays a thin React wrapper around
 * it — this is the one piece of real merge logic worth unit-testing in
 * isolation (see notifications.test.ts).
 *
 * A duplicate id (the same event delivered twice — e.g. a reconnect racing
 * the unread-count refetch in components/Notifications.tsx) replaces the
 * existing entry in place rather than adding a second row, so the list never
 * shows the same notification twice.
 */
export function mergeNewNotification(list: AppNotification[], incoming: AppNotification): AppNotification[] {
  const withoutDuplicate = list.filter((n) => n.id !== incoming.id);
  return [incoming, ...withoutDuplicate];
}
