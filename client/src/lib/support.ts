// Typed client for the Help & Support API (bug reports + feedback): thin wrapper over api(), like lib/resources.ts.
import { api } from '../api';
import { BUILD_ID } from '../config';

export type SupportTicketType = 'bug' | 'feedback';

// Auto-captured, non-sensitive context (docs/help-support-architecture.md, privacy section). Never carries the AI
// prompt/answer or a screenshot; those would be explicit opt-in additions, not part of this shape.
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

/** Builds the auto-captured context. `extra` folds in call-site fields (Coach turn grade/subject/classroomType, a failed request's requestId). */
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
