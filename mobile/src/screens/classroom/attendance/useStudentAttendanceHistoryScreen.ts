// Owns the Student Attendance History screen's state/API orchestration
// (§13's "student attendance history" screen). Seeded with the month the
// teacher was already viewing on Monthly Summary, with its own month nav so
// a teacher can keep browsing one student's history without a round trip
// back to the class-level screen.
import { useCallback, useEffect, useState } from 'react';
import { getStudentAttendanceHistory } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import { addMonths, currentMonthString } from '../../../lib/classroomDate';
import type { StudentAttendanceHistory } from '../../../types';

const CURRENT_MONTH = currentMonthString();

interface StudentAttendanceHistoryScreenState {
  month: string;
  currentMonth: string;
  history: StudentAttendanceHistory | null;
  loading: boolean;
  error: string;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  reload: () => void;
}

export function useStudentAttendanceHistoryScreen(studentId: string, initialMonth: string): StudentAttendanceHistoryScreenState {
  const [month, setMonth] = useState(initialMonth);
  const [history, setHistory] = useState<StudentAttendanceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getStudentAttendanceHistory(studentId, month);
      setHistory(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance history.');
    } finally {
      setLoading(false);
    }
  }, [studentId, month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const goToPreviousMonth = useCallback(() => setMonth((m) => addMonths(m, -1)), []);
  const goToNextMonth = useCallback(() => setMonth((m) => (m < CURRENT_MONTH ? addMonths(m, 1) : m)), []);

  return { month, currentMonth: CURRENT_MONTH, history, loading, error, goToPreviousMonth, goToNextMonth, reload: load };
}
