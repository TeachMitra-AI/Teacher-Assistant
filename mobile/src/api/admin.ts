// Thin wrapper over GET /api/admin/analytics (server/src/routes/admin.js),
// the same role-scoped (own school / district / all) usage-analytics
// endpoint the web Usage Dashboard (client/src/pages/AdminPage.tsx) calls —
// no backend change needed, per docs/mobile-app-plan.md's Phase 7c "Newly
// approved features" note.
import { api } from './client';
import type { Analytics } from '../types';

export async function getAnalytics(): Promise<Analytics> {
  return api<Analytics>('/admin/analytics');
}
