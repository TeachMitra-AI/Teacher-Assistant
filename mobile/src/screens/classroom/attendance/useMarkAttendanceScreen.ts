// Owns Mark Attendance's state/API orchestration (docs/mobile-app-plan.md
// "Screen -> useXScreen() -> state/API/business rules -> UI" convention,
// same as useClassHomeScreen.ts/useStudentsScreen.ts). Ports the exact
// interaction model from client/src/components/classroom/AttendanceDaily.tsx:
// the screen owns a working `Map` of statuses, taps update it instantly and
// recompute a live summary, and NOTHING is persisted until save() is called
// — one bulk POST, then a reload from the server response (the source of
// truth for what actually persisted, not the local guess).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDailyAttendance, saveAttendance } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import { addDays, todayDateString } from '../../../lib/classroomDate';
import { buildSaveMarks, computeDirty, computeLiveSummary, toggleStatus, type LiveAttendanceSummary } from '../../../lib/attendance';
import type { AttendanceRosterEntry, AttendanceStatus } from '../../../types';

const TODAY = todayDateString();

interface MarkAttendanceScreenState {
  date: string;
  today: string;
  roster: AttendanceRosterEntry[];
  statuses: Map<string, AttendanceStatus>;
  loading: boolean;
  error: string;
  saving: boolean;
  saveError: string;
  dirty: boolean;
  summary: LiveAttendanceSummary;
  goToPreviousDate: () => void;
  goToNextDate: () => void;
  setDate: (date: string) => void;
  toggle: (studentId: string, tapped: 'present' | 'absent') => void;
  markAllPresent: () => void;
  save: () => Promise<boolean>;
  reload: () => void;
}

export function useMarkAttendanceScreen(classId: string): MarkAttendanceScreenState {
  const [date, setDateState] = useState(TODAY);
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getDailyAttendance(classId, date);
      setRoster(data.roster);
      setStatuses(new Map(data.roster.map((r) => [r.studentId, r.status])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    // Standard fetch-on-mount(+date-change) pattern — see
    // useClassListScreen.ts's identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggle = useCallback((studentId: string, tapped: 'present' | 'absent') => {
    setStatuses((prev) => {
      const next = new Map(prev);
      const current = prev.get(studentId) || 'unmarked';
      next.set(studentId, toggleStatus(current, tapped));
      return next;
    });
  }, []);

  // Mobile-only convenience (§13) — no backend change, since POST
  // .../attendance already accepts a full batch. Pre-fills every row to
  // present; still requires the explicit Save tap to persist, same as any
  // other tap.
  const markAllPresent = useCallback(() => {
    setStatuses((prev) => {
      const next = new Map(prev);
      for (const r of roster) next.set(r.studentId, 'present');
      return next;
    });
  }, [roster]);

  const dirty = useMemo(() => computeDirty(roster, statuses), [roster, statuses]);
  const summary = useMemo(() => computeLiveSummary(roster, statuses), [roster, statuses]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    try {
      await saveAttendance(classId, date, buildSaveMarks(roster, statuses));
      await load(); // confirm what actually persisted, not just the local guess
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save attendance.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [classId, date, roster, statuses, load]);

  const goToPreviousDate = useCallback(() => setDateState((d) => addDays(d, -1)), []);
  // Disabled at the call site too, but guard here as well — `date >= TODAY`
  // never advances past today (§13's future-date restriction).
  const goToNextDate = useCallback(() => setDateState((d) => (d < TODAY ? addDays(d, 1) : d)), []);
  const setDate = useCallback((d: string) => setDateState(d > TODAY ? TODAY : d), []);

  return {
    date,
    today: TODAY,
    roster,
    statuses,
    loading,
    error,
    saving,
    saveError,
    dirty,
    summary,
    goToPreviousDate,
    goToNextDate,
    setDate,
    toggle,
    markAllPresent,
    save,
    reload: load,
  };
}
