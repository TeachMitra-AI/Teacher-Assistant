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
  context: QueryContext,
  classroomMode = false
): Promise<CoachResponse> {
  return api<CoachResponse>('/coach', {
    method: 'POST',
    // `classroomMode` is sent only when it is actually on, matching the
    // web's CoachPage.runTurn — a teacher who never touches the feature
    // produces a request body identical to the one this app has always sent.
    body: { query, language, context, ...(classroomMode ? { classroomMode: true } : {}) },
  });
}

// The multimodal-attachment sibling of askCoach — a SEPARATE endpoint (POST
// /api/coach/attachment, multipart) rather than a branch inside askCoach,
// matching the web's CoachPage.runTurnWithAttachments (see
// docs/multimodal-attachments-architecture.md). No `context` is sent — the
// attachment endpoint has no grade/subject fields. ALL files go in ONE
// request (repeated 'files' form entries), not one call per file, so the
// server sends everything to Gemini together in a single reasoning pass.
export async function askCoachWithAttachments(
  query: string,
  language: string,
  files: { uri: string; name: string; mimeType: string }[]
): Promise<CoachResponse> {
  const formData = new FormData();
  formData.append('query', query);
  formData.append('language', language);
  for (const file of files) {
    // React Native's FormData accepts a {uri, name, type} object in place of
    // a Blob — the RN/Expo runtime reads the local file at `uri` and streams
    // it as that form part. Not a real Blob, so the DOM FormData typings
    // don't describe it; the cast matches the pattern used throughout the
    // Expo ecosystem for multipart uploads.
    formData.append('files', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  return api<CoachResponse>('/coach/attachment', { method: 'POST', body: formData });
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
