// Typed client for Admin Settings (GET/PATCH /api/admin/feature-flags), a thin wrapper over api() like lib/admin.ts. Covers
// boolean feature flags and role-list access controls (see AdminFeatureFlag in types.ts).
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
