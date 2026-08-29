// Thin wrapper over POST /api/coach and POST /api/feedback (docs/mobile-app-plan.md
// §4.2, §26 Phase 4) — same request/response contract as client/src/pages/CoachPage.tsx's
// runTurn()/handleFeedback(), reusing the mobile api() client Phase 1 already
// built (Authorization header, token refresh, ApiError). No backend change:
// server/src/index.js's /api/coach handler and server/src/routes/queries.js's
// /api/feedback are called exactly as-is.
//
// listHistory/deleteHistoryItem/clearHistory/updateHistoryItem below are the
// history-sidebar counterpart, same contract as client/src/pages/CoachPage.tsx's
// loadHistory/handleDeleteHistory/handleClearHistory and
// client/src/hooks/useHistoryOverrides.ts's togglePin/rename (server/src/routes/queries.js:
// GET/DELETE/PATCH /api/queries — unchanged).
import { api } from './client';
import type { CoachResponse, HistoryItem, QueryContext } from '../types';

export async function askCoach(
  query: string,
  language: string,
  context: QueryContext
): Promise<CoachResponse> {
  return api<CoachResponse>('/coach', {
    method: 'POST',
    body: { query, language, context },
  });
}

export async function sendCoachFeedback(
  queryId: string,
  rating: 'helpful' | 'not_helpful'
): Promise<void> {
  await api('/feedback', { method: 'POST', body: { queryId, rating } });
}

// Same 20-item default and 50-item server cap as the web sidebar (§4.2).
export async function listHistory(limit = 20): Promise<HistoryItem[]> {
  const data = await api<{ queries: HistoryItem[] }>(`/queries?limit=${limit}`);
  return data.queries;
}

export async function deleteHistoryItem(id: string): Promise<void> {
  await api(`/queries/${id}`, { method: 'DELETE' });
}

export async function clearHistory(): Promise<void> {
  await api('/queries', { method: 'DELETE' });
}

export async function updateHistoryItem(
  id: string,
  patch: { title?: string; pinned?: boolean }
): Promise<void> {
  await api(`/queries/${id}`, { method: 'PATCH', body: patch });
}
