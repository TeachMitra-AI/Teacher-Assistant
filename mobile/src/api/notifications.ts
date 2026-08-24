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

// --- Phase 7b (Push Notifications) -------------------------------------
// Thin wrappers around POST/DELETE /api/notifications/device-tokens (§15,
// §26 Phase 7b) — same shape as every other function in this file.

export async function registerDeviceToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  await api('/notifications/device-tokens', { method: 'POST', body: { token, platform } });
}

// Standalone unregister (not the primary logout path — AuthContext.logout()
// sends the token inline with POST /auth/logout instead, so unregistration
// survives even after the session is cleared; see that file). Kept for
// completeness/future use (e.g. a "forget this device" action) and exercised
// directly by its own tests.
export async function unregisterDeviceToken(token: string): Promise<void> {
  await api(`/notifications/device-tokens/${encodeURIComponent(token)}`, { method: 'DELETE' });
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
