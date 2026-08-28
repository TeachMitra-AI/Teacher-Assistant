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
import { useAuth } from '../../../auth/AuthContext';
import { addDays, todayDateString } from '../../../lib/classroomDate';
import { buildSaveMarks, computeDirty, computeLiveSummary, toggleStatus, type LiveAttendanceSummary } from '../../../lib/attendance';
import {
  buildQueueKey,
  discardQueuedItem,
  enqueueAttendanceSave,
  getQueuedItem,
  retryQueuedItem,
  subscribeToQueue,
} from '../../../lib/offlineQueue';
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
  // Phase 12 (§18): set once this class/date's save has been written to the
  // offline queue (network failure at save time) and hasn't synced yet.
  pendingSync: boolean;
  // Set once that queued item has hit a genuine (non-network) sync failure —
  // distinct from pendingSync, which just means "not synced yet."
  queuedError: string | null;
  goToPreviousDate: () => void;
  goToNextDate: () => void;
  setDate: (date: string) => void;
  toggle: (studentId: string, tapped: 'present' | 'absent') => void;
  markAllPresent: () => void;
  save: () => Promise<boolean>;
  reload: () => void;
  retryQueued: () => Promise<void>;
  discardQueued: () => Promise<void>;
}

export function useMarkAttendanceScreen(classId: string): MarkAttendanceScreenState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [date, setDateState] = useState(TODAY);
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pendingSync, setPendingSync] = useState(false);
  const [queuedError, setQueuedError] = useState<string | null>(null);

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

  // Reflects this exact class/date's offline-queue state (Phase 12, §18):
  // checked on mount/date-change, and kept live via subscribeToQueue() so a
  // background sync (NetInfo reconnect / app foreground) that completes
  // while this screen is open updates the banner without a manual refresh.
  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSync(false);
      setQueuedError(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      getQueuedItem(userId, classId, date).then((item) => {
        if (cancelled) return;
        setPendingSync(!!item);
        setQueuedError(item?.permanentError ?? null);
      });
    };
    refresh();
    const unsubscribe = subscribeToQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, classId, date]);

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
    const marks = buildSaveMarks(roster, statuses);
    try {
      await saveAttendance(classId, date, marks);
      await load(); // confirm what actually persisted, not just the local guess
      return true;
    } catch (err) {
      // A genuine network failure (§18) queues the full snapshot for later
      // sync instead of surfacing an error — everything else (validation,
      // auth) is a real failure and must still be shown as one.
      if (err instanceof ApiError && err.status === 0 && userId) {
        await enqueueAttendanceSave(userId, classId, date, marks);
        // Re-baseline `roster` against what was just queued, exactly as a
        // real load() would after an online save — otherwise computeDirty()
        // keeps comparing against the pre-offline server snapshot, so a
        // second offline edit that happens to match that stale snapshot
        // reads as "not dirty" and silently fails to queue/coalesce at all
        // (found via manual device testing, not merely theorized).
        const marksByStudent = new Map(marks.map((m) => [m.studentId, m.status]));
        setRoster((prev) => prev.map((r) => ({ ...r, status: marksByStudent.get(r.studentId) ?? r.status })));
        setPendingSync(true);
        setQueuedError(null);
        return true;
      }
      setSaveError(err instanceof ApiError ? err.message : 'Could not save attendance.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [classId, date, roster, statuses, load, userId]);

  const retryQueued = useCallback(async () => {
    if (!userId) return;
    await retryQueuedItem(buildQueueKey(userId, classId, date), userId);
  }, [userId, classId, date]);

  const discardQueued = useCallback(async () => {
    if (!userId) return;
    await discardQueuedItem(buildQueueKey(userId, classId, date));
  }, [userId, classId, date]);

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
    pendingSync,
    queuedError,
    goToPreviousDate,
    goToNextDate,
    setDate,
    toggle,
    markAllPresent,
    save,
    reload: load,
    retryQueued,
    discardQueued,
  };
}
