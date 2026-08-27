// Owns Class Home's state/API orchestration (docs/mobile-app-plan.md Phase
// 7c's "Screen -> useXScreen() -> state/API/business rules -> UI"
// convention). Phase 8 Step 2 scope only: the live today's-summary strip,
// sourced from two already-existing, already-ported per-class calls (no new
// backend endpoint, no N+1 across the class list — both calls are scoped to
// the ONE selected class):
//   - getDailyAttendance(classId, today).summary — the actual "today"
//     present/absent/unmarked figures. The per-class analytics endpoint has
//     no `today` field (see ClassAnalytics's doc comment in types/index.ts),
//     so this is the only correct source for it; this is a read of existing
//     attendance data for display, not the Attendance feature itself
//     (marking/saving stays Phase 9's job, untouched here).
//   - getClassAnalytics(classId) — totalStudents, for the strip's context.
// The four shortcut cards below the strip stay navigation-only (Students is
// wired for real in Step 3; Attendance/Fees/Reports remain placeholders,
// each owned by its own later phase).
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getDailyAttendance, getClassAnalytics } from '../../api/classroomApi';
import { ApiError } from '../../api/client';
import type { AttendanceDaySummary } from '../../types';

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface ClassHomeScreenState {
  today: AttendanceDaySummary | null;
  totalStudents: number | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useClassHomeScreen(classId: string): ClassHomeScreenState {
  const [today, setToday] = useState<AttendanceDaySummary | null>(null);
  const [totalStudents, setTotalStudents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [daily, analytics] = await Promise.all([
        getDailyAttendance(classId, todayIsoDate()),
        getClassAnalytics(classId),
      ]);
      setToday(daily.summary);
      setTotalStudents(analytics.totalStudents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load today's summary.");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  // Focus-triggered, not just mount/classId-change — a teacher marking
  // attendance from this screen's own shortcut lands on the pushed
  // Attendance screen, then pops straight back HERE with the same classId,
  // which a plain mount-effect would never re-run for. Refetching on every
  // focus (initial mount included, per useFocusEffect's own contract) is
  // what keeps the strip from showing the pre-save snapshot after that
  // round trip.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { today, totalStudents, loading, error, reload: load };
}
