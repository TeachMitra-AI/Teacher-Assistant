// Owns the Fees screen's state/API orchestration (docs/mobile-app-plan.md
// "Screen -> useXScreen() -> state/API/business rules -> UI" convention,
// same as useMarkAttendanceScreen.ts). Ports the exact interaction model
// from client/src/components/classroom/FeeStatusBoard.tsx: each student has
// a local draft amount, a save button is enabled only once that draft
// differs from the last-saved amount, and a PATCH fires per tap — there is
// no bulk fee-upsert endpoint, unlike Attendance. Unlike a draft amount,
// `status` is never sent — it's always derived server-side from the PATCH
// response and merged back in here, never guessed locally.
import { useCallback, useEffect, useState } from 'react';
import { getFeeStatus, setFeeAmount } from '../../../api/classroomApi';
import { ApiError } from '../../../api/client';
import { addMonths, currentMonthString } from '../../../lib/classroomDate';
import type { ClassFeeStatus } from '../../../types';

const CURRENT_MONTH = currentMonthString();

interface FeeStatusScreenState {
  period: string;
  board: ClassFeeStatus | null;
  loading: boolean;
  error: string;
  savingId: string | null;
  saveError: string;
  drafts: Record<string, string>;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  setDraft: (studentId: string, text: string) => void;
  save: (studentId: string) => Promise<void>;
  reload: () => void;
}

export function useFeeStatusScreen(classId: string): FeeStatusScreenState {
  const [period, setPeriod] = useState(CURRENT_MONTH);
  const [board, setBoard] = useState<ClassFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getFeeStatus(classId, period);
      setBoard(data);
      setDrafts(Object.fromEntries(data.perStudent.map((s) => [s.studentId, String(s.amount || '')])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load fee status.');
    } finally {
      setLoading(false);
    }
  }, [classId, period]);

  useEffect(() => {
    // Standard fetch-on-mount(+period-change) pattern — see
    // useMarkAttendanceScreen.ts's identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const setDraft = useCallback((studentId: string, text: string) => {
    setDrafts((d) => ({ ...d, [studentId]: text }));
  }, []);

  const save = useCallback(async (studentId: string) => {
    if (!board || savingId) return;
    const draft = drafts[studentId] ?? '';
    const amount = draft.trim() === '' ? 0 : Number(draft);
    if (!Number.isInteger(amount) || amount < 0) return;

    setSavingId(studentId);
    setSaveError('');
    try {
      const fee = await setFeeAmount(studentId, period, amount);
      setBoard((prev) => {
        if (!prev) return prev;
        const perStudent = prev.perStudent.map((s) =>
          s.studentId === studentId ? { ...s, amount: fee.amount, status: fee.status, expectedAmount: fee.expectedAmount } : s
        );
        const paid = perStudent.filter((s) => s.status === 'paid').length;
        const partial = perStudent.filter((s) => s.status === 'partial').length;
        return {
          ...prev,
          perStudent,
          paid,
          partial,
          pending: perStudent.length - paid - partial,
          totalCollected: perStudent.reduce((sum, s) => sum + s.amount, 0),
        };
      });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save payment.');
    } finally {
      setSavingId(null);
    }
  }, [board, savingId, drafts, period]);

  return {
    period,
    board,
    loading,
    error,
    savingId,
    saveError,
    drafts,
    // No future-period restriction, matching FeeStatusBoard.tsx's own "Next
    // month" button, which — unlike Attendance's date/month nav — has no
    // `disabled` guard: a teacher may legitimately record an advance payment.
    goToPreviousMonth: () => setPeriod((m) => addMonths(m, -1)),
    goToNextMonth: () => setPeriod((m) => addMonths(m, 1)),
    setDraft,
    save,
    reload: load,
  };
}
