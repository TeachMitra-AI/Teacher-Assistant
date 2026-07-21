// Typed client for the My Library resource API. Thin wrappers over api() so
// pages/components don't hand-build request shapes. Ownership is enforced
// server-side from the auth token — nothing here sends a userId.
import { api } from '../api';
import type { LibraryResource, ResourceType } from '../types';

export interface CreateResourceInput {
  type: ResourceType;
  title: string;
  grade?: string;
  subject?: string;
  language?: string;
  content?: string;
  structured?: string;
  sourceQueryId?: string;
}

export interface ListResourcesParams {
  type?: ResourceType | '';
  q?: string;
}

export async function listResources(params: ListResourcesParams = {}): Promise<LibraryResource[]> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.q) search.set('q', params.q);
  const qs = search.toString();
  const data = await api<{ resources: LibraryResource[] }>(`/resources${qs ? `?${qs}` : ''}`);
  return data.resources;
}

export async function getResource(id: string): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>(`/resources/${id}`);
  return data.resource;
}

export async function createResource(input: CreateResourceInput): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>('/resources', { method: 'POST', body: input });
  return data.resource;
}

// Fields the workspace can edit. Every field is optional (PATCH semantics) but
// the server requires at least one. Ownership is enforced server-side from the
// token — nothing here sends a userId.
export interface UpdateResourceInput {
  type?: ResourceType;
  title?: string;
  grade?: string;
  subject?: string;
  language?: string;
  content?: string;
  structured?: string;
}

export async function updateResource(id: string, input: UpdateResourceInput): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>(`/resources/${id}`, { method: 'PATCH', body: input });
  return data.resource;
}

// AI workspace action ids the server understands (see server/src/routes/resources.js).
export type AiActionId = 'simplify' | 'add_activities' | 'add_assessment' | 'adapt_grade';

export interface AiActionResult {
  suggestion: string;
  requestId: string;
}

// Ask the server to generate a suggested revision for a resource. The server
// keeps the AI key server-side and never persists the suggestion — the client
// decides whether to Apply it. `targetGrade` is only used by 'adapt_grade'.
export async function runAiAction(
  id: string,
  action: AiActionId,
  options: { targetGrade?: string } = {}
): Promise<AiActionResult> {
  return api<AiActionResult>(`/resources/${id}/ai-action`, {
    method: 'POST',
    body: { action, ...(options.targetGrade ? { targetGrade: options.targetGrade } : {}) },
  });
}

export async function deleteResource(id: string): Promise<void> {
  await api(`/resources/${id}`, { method: 'DELETE' });
}
