// Owns Admin Analytics' state/API orchestration, separate from the screen's
// JSX — the "Screen -> useXScreen() -> state/API/business rules -> UI"
// convention this pass follows (docs/mobile-app-plan.md's Phase 7c
// architecture note), not a literal Activa Clinician port.
import { useCallback, useEffect, useState } from 'react';
import { getAnalytics } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Analytics } from '../../types';

interface AdminAnalyticsScreenState {
  data: Analytics | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useAdminAnalyticsScreen(): AdminAnalyticsScreenState {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAnalytics();
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
