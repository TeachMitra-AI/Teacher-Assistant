// Typed client for the Admin Support Inbox — native port of
// client/src/lib/adminSupport.ts, same thin-wrapper-over-api() shape as
// admin.ts. Every listing is paginated SERVER-side, and role enforcement
// (super_admin only) happens server-side; nothing here can widen what the
// caller is allowed to see.
import { api } from './client';
import type { Paged } from './admin';
import type {
  SupportNote, SupportTicketDetail, SupportTicketStats, SupportTicketStatus, SupportTicketSummary, SupportTicketType,
} from '../types';

export interface SupportTicketQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: SupportTicketStatus | '';
  type?: SupportTicketType | '';
  category?: string;
  schoolId?: string;
  from?: string;
  to?: string;
}

// Mirrors admin.ts's listParams: empty filters are dropped rather than sent
// as e.g. `status=`, and `page=1` is omitted so the common case produces a
// clean URL.
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

export async function listSupportTickets(query: SupportTicketQuery = {}): Promise<Paged<SupportTicketSummary>> {
  const page = query.page ?? 1;
  const qs = listParams({
    page,
    limit: query.limit,
    q: query.q,
    status: query.status,
    type: query.type,
    category: query.category,
    schoolId: query.schoolId,
    from: query.from,
    to: query.to,
  });
  const data = await api<{ tickets: SupportTicketSummary[]; total?: number; page?: number; limit?: number }>(
    `/admin/support/tickets${qs}`
  );
  return {
    items: data.tickets,
    total: typeof data.total === 'number' ? data.total : data.tickets.length,
    page: typeof data.page === 'number' ? data.page : page,
    limit: typeof data.limit === 'number' ? data.limit : data.tickets.length,
  };
}

export async function getSupportTicketStats(): Promise<SupportTicketStats> {
  return api<SupportTicketStats>('/admin/support/tickets/stats');
}

export async function getSupportTicket(id: string): Promise<SupportTicketDetail> {
  const data = await api<{ ticket: SupportTicketDetail }>(`/admin/support/tickets/${id}`);
  return data.ticket;
}

export async function updateSupportTicketStatus(id: string, status: SupportTicketStatus): Promise<void> {
  await api(`/admin/support/tickets/${id}/status`, { method: 'PATCH', body: { status } });
}

export async function addSupportTicketNote(id: string, body: string): Promise<SupportNote> {
  const data = await api<{ note: SupportNote }>(`/admin/support/tickets/${id}/notes`, { method: 'POST', body: { body } });
  return data.note;
}
