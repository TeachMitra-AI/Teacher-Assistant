// Owns the Reports screen's "All Classes" tab state/API orchestration
// (docs/mobile-app-plan.md "Screen -> useXScreen() -> state/API/business
// rules -> UI" convention). GET /classroom/analytics/overview — the first
// UI ever built against this endpoint (no web equivalent exists, §26 Phase
// 11's own "genuinely new, not a port" scope note), teacher-wide rather
// than scoped to the one class Reports was pushed from.
import { useCallback, useEffect, useState } from 'react';
import { getTeacherAnalyticsOverview } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import type { TeacherAnalyticsOverview } from '../../../types';

interface OverviewReportScreenState {
  overview: TeacherAnalyticsOverview | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useOverviewReportScreen(): OverviewReportScreenState {
  const [overview, setOverview] = useState<TeacherAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await getTeacherAnalyticsOverview());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { overview, loading, error, reload: load };
}
