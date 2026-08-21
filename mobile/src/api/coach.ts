// Thin wrapper over POST /api/coach and POST /api/feedback (docs/mobile-app-plan.md
// §4.2, §26 Phase 4) — same request/response contract as client/src/pages/CoachPage.tsx's
// runTurn()/handleFeedback(), reusing the mobile api() client Phase 1 already
// built (Authorization header, token refresh, ApiError). No backend change:
// server/src/index.js's /api/coach handler and server/src/routes/queries.js's
// /api/feedback are called exactly as-is.
import { api } from './client';
import type { CoachResponse, QueryContext } from '../types';

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
