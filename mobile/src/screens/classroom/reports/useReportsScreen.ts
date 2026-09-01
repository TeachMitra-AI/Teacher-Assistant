// Owns the Reports screen's state/API orchestration (docs/mobile-app-plan.md
// "Screen -> useXScreen() -> state/API/business rules -> UI" convention,
// same as useFeeStatusScreen.ts). Reuses the exact same GET .../fees?period=
// call the Fees tab already calls (getFeeStatus) — this screen is a
// read-only, filterable view over the same data, never a second source of
// truth. Ported from client/src/components/classroom/ReportsPanel.tsx.
import { useCallback, useEffect, useState } from 'react';
import { getFeeStatus, downloadFeesReport } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import { addMonths, currentMonthString } from '../../../lib/classroomDate';
import type { ClassFeeStatus, FeeStatus } from '../../../types';

export type TileFilter = 'all' | FeeStatus | 'overpaid';

const CURRENT_MONTH = currentMonthString();

interface ReportsScreenState {
  period: string;
  board: ClassFeeStatus | null;
  loading: boolean;
  error: string;
  downloading: boolean;
  selectedFilter: TileFilter | null;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  setSelectedFilter: (filter: TileFilter | null) => void;
  // Throws on failure (an ApiError, or whatever the underlying call threw) —
  // deliberately not swallowed here, so the screen decides how to surface it
  // (mobile has no toast system to mirror the web's `show(..., 'error')`;
  // see ReportsScreen.tsx's Alert.alert catch).
  download: () => Promise<void>;
  reload: () => void;
}

export function useReportsScreen(classId: string): ReportsScreenState {
  const [period, setPeriod] = useState(CURRENT_MONTH);
  const [board, setBoard] = useState<ClassFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<TileFilter | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBoard(await getFeeStatus(classId, period));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the fee report.');
    } finally {
      setLoading(false);
    }
  }, [classId, period]);

  useEffect(() => {
    // Standard fetch-on-mount(+period-change) pattern — see
    // useFeeStatusScreen.ts's identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // A filter selected in one month shouldn't silently carry over and
    // re-open the modal against a different month's data — mirrors the
    // web's identical `useEffect(() => setSelectedFilter(null), [period])`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedFilter(null);
  }, [period]);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFeesReport(classId, period);
    } finally {
      setDownloading(false);
    }
  }, [classId, period, downloading]);

  return {
    period,
    board,
    loading,
    error,
    downloading,
    selectedFilter,
    goToPreviousMonth: () => setPeriod((m) => addMonths(m, -1)),
    goToNextMonth: () => setPeriod((m) => addMonths(m, 1)),
    setSelectedFilter,
    download,
    reload: load,
  };
}
