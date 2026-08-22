import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Wallet } from 'lucide-react';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { getFeeStatus, setFeeAmount } from '../../lib/classroomApi';
import { addMonths, currentMonthString, formatMonthLabel } from '../../lib/classroomDate';
import type { ClassFeeStatus, FeeStatus } from '../../types';

const CURRENT_MONTH = currentMonthString();

function statusLabel(status: FeeStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  return 'Pending';
}

// One class's month-wise fee/payment status
// (docs/fee-tracking-amounts-plan.md). Each student has an amount-paid
// input; status (paid/partial/pending) is always derived server-side from
// that amount vs the class's fee amount, never set directly here. Unlike
// Attendance (bulk save), there's no bulk fee-upsert endpoint, so each save
// PATCHes immediately.
export default function FeeStatusBoard({ classId, className }: { classId: string; className: string }) {
  const { show } = useToast();

  const [period, setPeriod] = useState(CURRENT_MONTH);
  const [board, setBoard] = useState<ClassFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  // Local text-entry state per student, keyed by studentId — kept separate
  // from `board` so typing doesn't fight with the loaded/optimistic amount
  // until the teacher actually saves.
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
    load();
  }, [load]);

  async function save(studentId: string, amount: number) {
    if (!board || savingId || amount < 0 || !Number.isInteger(amount)) return;
    setSavingId(studentId);
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
      show(err instanceof ApiError ? err.message : 'Could not save payment.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="classroom-attendance">
      <h2 className="classroom-panel-title">Fees — {className}</h2>
      <p className="classroom-hint">
        {board?.feeAmount != null
          ? `Monthly fee: ₹${board.feeAmount} per student. Set on the Classes tab.`
          : 'No monthly fee amount set for this class yet — set one on the Classes tab to track pending amounts.'}
      </p>

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
            <div className="classroom-summary-tile tile-partial">
              <span className="classroom-summary-value">{board.partial}</span>
              <span className="classroom-summary-label">Partial</span>
            </div>
            <div className="classroom-summary-tile tile-absent">
              <span className="classroom-summary-value">{board.pending}</span>
              <span className="classroom-summary-label">Pending</span>
            </div>
          </div>
          <p className="classroom-hint">
            ₹{board.totalCollected} collected{board.totalExpected > 0 ? ` of ₹${board.totalExpected} expected` : ''} this month.
          </p>

          {board.perStudent.length === 0 && (
            <div className="classroom-empty">
              <span className="classroom-empty-icon" aria-hidden="true"><Wallet size={22} strokeWidth={1.8} /></span>
              <p className="library-empty-title">No active students</p>
              <p className="library-empty-hint">Add students to this class first, from the Students tab.</p>
            </div>
          )}

          {board.perStudent.length > 0 && (
            <ul className="classroom-att-list">
              {board.perStudent.map((s) => {
                const draft = drafts[s.studentId] ?? '';
                const draftAmount = draft.trim() === '' ? 0 : Number(draft);
                const dirty = draftAmount !== (s.amount || 0);
                return (
                  <li key={s.studentId} className="classroom-att-row">
                    <div className="classroom-att-info">
                      <span className="classroom-att-name">{s.name}</span>
                      {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                    </div>
                    <div className="classroom-att-actions">
                      <span className={`classroom-att-btn ${s.status} active`} aria-hidden="true">
                        {statusLabel(s.status)}
                        {s.expectedAmount != null && ` (₹${s.expectedAmount})`}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="classroom-fee-amount-input"
                        value={draft}
                        disabled={savingId === s.studentId}
                        aria-label={`Amount paid by ${s.name}`}
                        onChange={(e) => setDrafts((d) => ({ ...d, [s.studentId]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        title="Save amount paid"
                        aria-label={`Save amount paid for ${s.name}`}
                        disabled={savingId === s.studentId || !dirty || draftAmount < 0 || !Number.isInteger(draftAmount)}
                        onClick={() => save(s.studentId, draftAmount)}
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
