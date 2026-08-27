// Owns the Reports screen's "This Class" tab state/API orchestration
// (docs/mobile-app-plan.md "Screen -> useXScreen() -> state/API/business
// rules -> UI" convention). A single already-existing, already-ported call
// — no new backend endpoint, and the exact same one Class Home's own
// summary strip uses, so these numbers can never drift from what a teacher
// already saw there.
import { useCallback, useEffect, useState } from 'react';
import { getClassAnalytics } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import type { ClassAnalytics } from '../../../types';

interface ClassReportScreenState {
  analytics: ClassAnalytics | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useClassReportScreen(classId: string): ClassReportScreenState {
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAnalytics(await getClassAnalytics(classId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this class’s report.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    // Standard fetch-on-mount pattern — see useClassListScreen.ts's
    // identical, already-documented case. Unlike Class Home, nothing is ever
    // pushed on top of Reports in the current navigation, so there is no
    // "pop back to a stale mount" case here to guard against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { analytics, loading, error, reload: load };
}
