// Typed client for the Notification API: thin wrapper over api(), like lib/support.ts.
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
 * Prepends a realtime notification (Socket.IO 'notification:new') to the cached list, de-duping by id. A pure function so
 * components/Notifications.tsx stays a thin wrapper and the merge is unit-testable. A duplicate id (e.g. a reconnect racing
 * the unread-count refetch) replaces the entry in place, so the list never shows one twice.
 */
export function mergeNewNotification(list: AppNotification[], incoming: AppNotification): AppNotification[] {
  const withoutDuplicate = list.filter((n) => n.id !== incoming.id);
  return [incoming, ...withoutDuplicate];
}
