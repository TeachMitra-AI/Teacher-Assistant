// Typed client for the paginated admin list endpoints: thin wrappers over api(), like lib/resources.ts. Pagination is
// server-side (`total` drives "showing 1–25 of 142"). School scoping is enforced from the token; `schoolId` is only
// honoured inside that scope.
import { api } from '../api';
import type { AdminSchool, AdminUser, Role, UserStatus } from '../types';

// One page of results plus the total number of matching rows.
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminUserQuery {
  page?: number;
  limit?: number;
  q?: string;
  role?: Role | '';
  status?: UserStatus | '';
  schoolId?: string;
}

export interface AdminSchoolQuery {
  page?: number;
  limit?: number;
  q?: string;
}

// Shared param building: `page=1` is omitted for a clean URL and empty filters are dropped rather than sent as `role=`.
function listParams(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (key === 'page' && value === 1) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// The server always returns total/page/limit, but an older deployment might not; derive from the payload rather than showing "of undefined".
function toPaged<T>(
  items: T[],
  body: { total?: number; page?: number; limit?: number },
  requestedPage: number
): Paged<T> {
  return {
    items,
    total: typeof body.total === 'number' ? body.total : items.length,
    page: typeof body.page === 'number' ? body.page : requestedPage,
    limit: typeof body.limit === 'number' ? body.limit : items.length,
  };
}

export async function listAdminUsers(query: AdminUserQuery = {}): Promise<Paged<AdminUser>> {
  const page = query.page ?? 1;
  const qs = listParams({
    page,
    limit: query.limit,
    q: query.q,
    role: query.role,
    status: query.status,
    schoolId: query.schoolId,
  });
  const data = await api<{ users: AdminUser[]; total?: number; page?: number; limit?: number }>(
    `/admin/users${qs}`
  );
  return toPaged(data.users, data, page);
}

export async function listPendingUsers(query: AdminUserQuery = {}): Promise<Paged<AdminUser>> {
  const page = query.page ?? 1;
  const qs = listParams({ page, limit: query.limit, q: query.q });
  const data = await api<{ users: AdminUser[]; total?: number; page?: number; limit?: number }>(
    `/admin/users/pending${qs}`
  );
  return toPaged(data.users, data, page);
}

export async function listAdminSchools(query: AdminSchoolQuery = {}): Promise<Paged<AdminSchool>> {
  const page = query.page ?? 1;
  const qs = listParams({ page, limit: query.limit, q: query.q });
  const data = await api<{ schools: AdminSchool[]; total?: number; page?: number; limit?: number }>(
    `/admin/schools${qs}`
  );
  return toPaged(data.schools, data, page);
}

export interface CreateSchoolInput {
  name: string;
  code: string;
  district?: string;
  state?: string;
}

export async function createSchool(input: CreateSchoolInput): Promise<AdminSchool> {
  const data = await api<{ school: AdminSchool }>('/admin/schools', { method: 'POST', body: input });
  return data.school;
}

export async function decidePendingUser(id: string, action: 'approve' | 'reject'): Promise<void> {
  await api(`/admin/users/${id}/${action}`, { method: 'PATCH' });
}

// Suspending ends the account's sessions and blocks sign-in; reactivating lets the teacher sign in again.
export async function setAccountStatus(id: string, action: 'suspend' | 'reactivate'): Promise<void> {
  await api(`/admin/users/${id}/${action}`, { method: 'PATCH' });
}

export async function changeUserRole(id: string, role: Role): Promise<void> {
  await api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } });
}
