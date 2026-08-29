// Typed client for the Help & Support API (bug reports + feedback) — mobile
// port of client/src/lib/support.ts, same POST /support/tickets contract.
// Phase 1 only, matching the web version: no attachment upload.
import { api } from './client';

export type SupportTicketType = 'bug' | 'feedback';

// Auto-captured, non-sensitive context (server/src/routes/support.js's
// contextSchema — every field optional and independently bounded). No
// mobile equivalent of the web's route/userAgent/viewport (browser-only
// concepts), so those are simply omitted rather than filled with a
// meaningless placeholder.
export interface SupportTicketContext {
  buildId?: string;
  theme?: 'light' | 'dark';
  language?: string;
  grade?: string;
  subject?: string;
  classroomType?: string;
}

export interface CreateSupportTicketInput {
  type: SupportTicketType;
  category: string;
  description?: string;
  context?: SupportTicketContext;
}

export interface SupportTicketResult {
  id: string;
  status: string;
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicketResult> {
  const data = await api<{ success: boolean; id: string; status: string }>('/support/tickets', {
    method: 'POST',
    body: input,
  });
  return { id: data.id, status: data.status };
}

// Builds the auto-captured context object — the mobile analogue of the
// web's captureAutoContext (same `extra` fold-in shape), without the
// browser-only fields it also sets.
export function captureAutoContext(
  theme: 'light' | 'dark',
  language?: string,
  extra: Partial<SupportTicketContext> = {}
): SupportTicketContext {
  return {
    buildId: 'mobile',
    theme,
    language,
    ...extra,
  };
}
