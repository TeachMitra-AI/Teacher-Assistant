import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, X as XIcon, Wallet } from 'lucide-react';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { getFeeStatus, setFeeStatus } from '../../lib/classroomApi';
import { addMonths, currentMonthString, formatMonthLabel } from '../../lib/classroomDate';
import type { ClassFeeStatus, FeeStatus } from '../../types';

const CURRENT_MONTH = currentMonthString();

// One class's month-wise fee/payment status (docs/classroom-feature-plan.md
// Phase 4, §11). V1 is deliberately Paid/Pending only — a single toggle per
// student, no amount/due-date/notes on screen. Unlike Attendance (bulk
// save), there's no bulk fee-upsert endpoint, so each tap PATCHes
// immediately — that IS the one intentional change, not a batchable series
// of taps against a save button.
export default function FeeStatusBoard({ classId, className }: { classId: string; className: string }) {
  const { show } = useToast();

  const [period, setPeriod] = useState(CURRENT_MONTH);
  const [board, setBoard] = useState<ClassFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getFeeStatus(classId, period);
      setBoard(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load fee status.');
    } finally {
      setLoading(false);
    }
  }, [classId, period]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(studentId: string, current: FeeStatus) {
    if (!board || savingId) return;
    const next: FeeStatus = current === 'paid' ? 'pending' : 'paid';
    setSavingId(studentId);

    // Optimistic update — the summary tiles and the row both flip instantly;
    // reverted on failure so the UI never shows a status that didn't persist.
    const previous = board;
    setBoard({
      ...board,
      paid: board.paid + (next === 'paid' ? 1 : -1),
      pending: board.pending + (next === 'pending' ? 1 : -1),
      perStudent: board.perStudent.map((s) => (s.studentId === studentId ? { ...s, status: next } : s)),
    });

    try {
      await setFeeStatus(studentId, period, next);
    } catch (err) {
      setBoard(previous);
      show(err instanceof ApiError ? err.message : 'Could not update payment status', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="classroom-attendance">
      <h2 className="classroom-panel-title">Fees — {className}</h2>

      <div className="classroom-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setPeriod((m) => addMonths(m, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="classroom-date-display">{formatMonthLabel(period)}</span>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setPeriod((m) => addMonths(m, 1))}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && <p className="classroom-hint">Loading fee status…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && board && (
        <>
          <div className="classroom-summary-tiles">
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">{board.totalStudents}</span>
              <span className="classroom-summary-label">Total Students</span>
            </div>
            <div className="classroom-summary-tile tile-present">
              <span className="classroom-summary-value">{board.paid}</span>
              <span className="classroom-summary-label">Paid</span>
            </div>
            <div className="classroom-summary-tile tile-absent">
              <span className="classroom-summary-value">{board.pending}</span>
              <span className="classroom-summary-label">Pending</span>
            </div>
          </div>

          {board.perStudent.length === 0 && (
            <div className="classroom-empty">
              <span className="classroom-empty-icon" aria-hidden="true"><Wallet size={22} strokeWidth={1.8} /></span>
              <p className="library-empty-title">No active students</p>
              <p className="library-empty-hint">Add students to this class first, from the Students tab.</p>
            </div>
          )}

          {board.perStudent.length > 0 && (
            <ul className="classroom-att-list">
              {board.perStudent.map((s) => (
                <li key={s.studentId} className="classroom-att-row">
                  <div className="classroom-att-info">
                    <span className="classroom-att-name">{s.name}</span>
                    {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                  </div>
                  <div className="classroom-att-actions">
                    <button
                      type="button"
                      className={`classroom-att-btn ${s.status === 'paid' ? 'present' : 'absent'} active`}
                      disabled={savingId === s.studentId}
                      aria-label={`${s.name}: ${s.status === 'paid' ? 'Paid' : 'Pending'}, tap to mark ${s.status === 'paid' ? 'pending' : 'paid'}`}
                      onClick={() => toggle(s.studentId, s.status)}
                    >
                      {s.status === 'paid' ? <Check size={15} aria-hidden="true" /> : <XIcon size={15} aria-hidden="true" />}
                      {s.status === 'paid' ? 'Paid' : 'Pending'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
