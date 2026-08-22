// Ported from client/src/lib/notifications.ts (docs/mobile-app-plan.md §9) —
// identical logic, only the import paths changed.
import { api } from './client';
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
 * onto the cached list, deduping by id. Same pure merge function as the web
 * client's lib/notifications.ts — the one piece of real merge logic worth
 * unit-testing in isolation.
 */
export function mergeNewNotification(list: AppNotification[], incoming: AppNotification): AppNotification[] {
  const withoutDuplicate = list.filter((n) => n.id !== incoming.id);
  return [incoming, ...withoutDuplicate];
}
