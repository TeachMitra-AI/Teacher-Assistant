// Typed client for the Schedule a Call admin inbox (super_admin only). Thin
// wrapper over api(), same shape as lib/adminSupport.ts. Kept as its own
// module — mirroring the support.ts / adminSupport.ts split — since
// lib/scheduleDemo.ts is scoped to the public, unauthenticated visitor
// endpoints.
import { api } from '../api';
import type { Paged } from './admin';
import type { DemoBooking } from './scheduleDemo';

export interface AdminDemoBooking extends DemoBooking {
  email: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

export interface DemoBookingQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: 'confirmed' | 'cancelled' | '';
  from?: string;
  to?: string;
}

// Mirrors lib/adminSupport.ts's listParams exactly.
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

export async function listDemoBookings(query: DemoBookingQuery = {}): Promise<Paged<AdminDemoBooking>> {
  const page = query.page ?? 1;
  const qs = listParams({ page, limit: query.limit, q: query.q, status: query.status, from: query.from, to: query.to });
  const data = await api<{ bookings: AdminDemoBooking[]; total?: number; page?: number; limit?: number }>(
    `/admin/demo-bookings${qs}`
  );
  return {
    items: data.bookings,
    total: typeof data.total === 'number' ? data.total : data.bookings.length,
    page: typeof data.page === 'number' ? data.page : page,
    limit: typeof data.limit === 'number' ? data.limit : data.bookings.length,
  };
}
