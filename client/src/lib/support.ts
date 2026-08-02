// Typed client for the Help & Support API (bug reports + feedback). Thin
// wrapper over api(), same shape as lib/resources.ts — pages/components don't
// hand-build the request. Phase 1 only: no attachment upload yet.
import { api } from '../api';
import { BUILD_ID } from '../config';

export type SupportTicketType = 'bug' | 'feedback';

// Auto-captured, non-sensitive context (see docs/help-support-architecture.md's
// privacy section). Deliberately never carries the AI prompt/answer or a
// screenshot — those are Phase 2, opt-in additions a caller would add
// explicitly, never folded into this auto-captured shape.
export interface SupportTicketContext {
  route?: string;
  buildId?: string;
  userAgent?: string;
  viewport?: string;
  theme?: 'light' | 'dark';
  language?: string;
  requestId?: string;
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

/**
 * Builds the auto-captured context object. `extra` folds in call-site-specific
 * fields — the current Coach turn's grade/subject/classroomType, or a failed
 * request's requestId — without this helper needing to know about them.
 */
export function captureAutoContext(
  theme: 'light' | 'dark',
  language?: string,
  extra: Partial<SupportTicketContext> = {}
): SupportTicketContext {
  return {
    route: window.location.pathname,
    buildId: BUILD_ID,
    userAgent: navigator.userAgent.slice(0, 300),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    theme,
    language,
    ...extra,
  };
}
