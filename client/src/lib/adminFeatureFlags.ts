// Typed client for Admin Settings (GET/PATCH /api/admin/feature-flags), the
// same thin-wrapper-over-api() shape as lib/admin.ts. Covers both setting
// kinds the registry supports: boolean feature flags (Feature Management)
// and role-list access controls (AI Access) — see types.ts's AdminFeatureFlag.
import { api } from '../api';
import type { AdminFeatureFlag, Role } from '../types';

export async function listFeatureFlags(): Promise<AdminFeatureFlag[]> {
  const res = await api<{ flags: AdminFeatureFlag[] }>('/admin/feature-flags');
  return res.flags;
}

export async function setBooleanSetting(id: string, enabled: boolean): Promise<AdminFeatureFlag> {
  return api<AdminFeatureFlag>(`/admin/feature-flags/${id}`, { method: 'PATCH', body: { enabled } });
}

export async function setRoleListSetting(id: string, roles: Role[]): Promise<AdminFeatureFlag> {
  return api<AdminFeatureFlag>(`/admin/feature-flags/${id}`, { method: 'PATCH', body: { roles } });
}
