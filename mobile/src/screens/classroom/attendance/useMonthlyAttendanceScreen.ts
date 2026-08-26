// Owns Monthly Summary's state/API orchestration (docs/mobile-app-plan.md
// "Screen -> useXScreen() -> state/API/business rules -> UI" convention).
// Loads BOTH the per-student month totals (getAttendanceMonthSummary, the
// same data client/src/components/classroom/AttendanceMonthly.tsx already
// renders as a list) AND the day-by-day class totals
// (getClassAttendanceHistory) that power the native calendar grid §13 asks
// for — a data shape no existing web screen consumes yet.
import { useCallback, useEffect, useState } from 'react';
import { getAttendanceMonthSummary, getClassAttendanceHistory } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import { addMonths, currentMonthString } from '../../../lib/classroomDate';
import type { ClassAttendanceHistory, ClassAttendanceMonthSummary } from '../../../types';

const CURRENT_MONTH = currentMonthString();

interface MonthlyAttendanceScreenState {
  month: string;
  currentMonth: string;
  summary: ClassAttendanceMonthSummary | null;
  history: ClassAttendanceHistory | null;
  loading: boolean;
  error: string;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  reload: () => void;
}

export function useMonthlyAttendanceScreen(classId: string): MonthlyAttendanceScreenState {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [summary, setSummary] = useState<ClassAttendanceMonthSummary | null>(null);
  const [history, setHistory] = useState<ClassAttendanceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryData, historyData] = await Promise.all([
        getAttendanceMonthSummary(classId, month),
        getClassAttendanceHistory(classId, month),
      ]);
      setSummary(summaryData);
      setHistory(historyData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the monthly summary.');
    } finally {
      setLoading(false);
    }
  }, [classId, month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const goToPreviousMonth = useCallback(() => setMonth((m) => addMonths(m, -1)), []);
  const goToNextMonth = useCallback(() => setMonth((m) => (m < CURRENT_MONTH ? addMonths(m, 1) : m)), []);

  return { month, currentMonth: CURRENT_MONTH, summary, history, loading, error, goToPreviousMonth, goToNextMonth, reload: load };
}
