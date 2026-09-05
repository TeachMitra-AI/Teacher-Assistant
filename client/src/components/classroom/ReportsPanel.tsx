import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileBarChart, X } from 'lucide-react';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { getFeeStatus, downloadFeesReport } from '../../lib/classroomApi';
import { addMonths, currentMonthString, formatMonthLabel } from '../../lib/classroomDate';
import type { ClassFeeStatus, FeeStatus, StudentFeeStatus } from '../../types';

type TileFilter = 'all' | FeeStatus | 'overpaid';

const STATUS_LABEL: Record<FeeStatus, string> = { paid: 'Paid', partial: 'Partial', pending: 'Pending' };

function isOverpaid(s: StudentFeeStatus): boolean {
  return s.expectedAmount != null && s.amount > s.expectedAmount;
}

// The fees API orders perStudent by name (server/src/lib/classroomFees.js) —
// re-sort here by roll number for these lists specifically, since a teacher
// scans a fee report roll-wise, not alphabetically. Numeric rolls sort
// numerically (so "2" comes before "10"); non-numeric or missing rolls sort
// after, by name, so nobody silently vanishes from the list.
function byRollNumber(a: StudentFeeStatus, b: StudentFeeStatus): number {
  const an = a.rollNumber ? Number(a.rollNumber) : NaN;
  const bn = b.rollNumber ? Number(b.rollNumber) : NaN;
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  if (!Number.isNaN(an)) return -1;
  if (!Number.isNaN(bn)) return 1;
  return a.name.localeCompare(b.name);
}

function feeBadgeText(s: StudentFeeStatus): string {
  if (s.expectedAmount == null) return 'No fee amount set';
  const owed = s.expectedAmount - s.amount;
  switch (s.status) {
    case 'paid': {
      const extra = s.amount - s.expectedAmount;
      return extra > 0 ? `Paid ₹${s.amount} · ₹${extra} extra` : `Paid ₹${s.amount}`;
    }
    case 'partial':
      return `Paid ₹${s.amount} · Owes ₹${owed}`;
    default:
      return `Owes ₹${owed}`;
  }
}

const CURRENT_MONTH = currentMonthString();

// Fee dashboard for the Reports tab (docs/fee-tracking-amounts-plan.md
// Step 2). Reuses the same GET .../fees?period= endpoint the Fees tab
// already calls — its response already carries every total this dashboard
// needs (totalCollected/totalExpected/paid/partial/pending/perStudent), so
// no new backend route was needed for this step.
export default function ReportsPanel({ classId, className }: { classId: string; className: string }) {
  const { show } = useToast();
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
      const data = await getFeeStatus(classId, period);
      setBoard(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the fee report.');
    } finally {
      setLoading(false);
    }
  }, [classId, period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedFilter(null);
  }, [period]);

  async function downloadReport() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFeesReport(classId, period);
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not download the fee report.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  const owing = board ? board.perStudent.filter((s) => s.status !== 'paid').sort(byRollNumber) : [];
  const overpaidCount = board ? board.perStudent.filter(isOverpaid).length : 0;

  const modalStudents =
    selectedFilter === null
      ? []
      : selectedFilter === 'all'
        ? [...(board?.perStudent ?? [])].sort(byRollNumber)
        : selectedFilter === 'overpaid'
          ? (board?.perStudent ?? []).filter(isOverpaid).sort(byRollNumber)
          : (board?.perStudent ?? []).filter((s) => s.status === selectedFilter).sort(byRollNumber);

  const modalTitle =
    selectedFilter === 'all'
      ? 'All students'
      : selectedFilter === 'overpaid'
        ? 'Students who overpaid'
        : selectedFilter
          ? `Students marked ${STATUS_LABEL[selectedFilter].toLowerCase()}`
          : '';

  const tileDefs: Array<{ filter: TileFilter; value: number; label: string; toneClass: string; ariaLabel: string }> = board
    ? [
        { filter: 'all', value: board.totalStudents, label: 'Total Students', toneClass: '', ariaLabel: 'Show all students' },
        { filter: 'paid', value: board.paid, label: 'Paid', toneClass: 'tile-present', ariaLabel: 'Show paid students' },
        { filter: 'partial', value: board.partial, label: 'Partial', toneClass: 'tile-partial', ariaLabel: 'Show partially paid students' },
        { filter: 'pending', value: board.pending, label: 'Pending', toneClass: 'tile-absent', ariaLabel: 'Show pending students' },
        { filter: 'overpaid', value: overpaidCount, label: 'Overpaid', toneClass: 'tile-info', ariaLabel: 'Show overpaid students' },
      ]
    : [];

  const modalToneClass = tileDefs.find((t) => t.filter === selectedFilter)?.toneClass ?? '';

  return (
    <div className="classroom-attendance">
      <h2 className="classroom-panel-title">Reports — {className}</h2>

      <div className="classroom-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setPeriod((m) => addMonths(m, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="classroom-date-display">{formatMonthLabel(period)}</span>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setPeriod((m) => addMonths(m, 1))}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" title="Download Excel report" aria-label="Download this month's fee report as an Excel file" disabled={downloading || loading} onClick={downloadReport}>
          <Download size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && <p className="classroom-hint">Loading report…</p>}
      {!loading && error && (
        <div className="auth-error" role="alert">
          {error}
          <button type="button" className="btn-text" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && board && (
        <>
          <p className="classroom-panel-title" style={{ fontSize: '0.95rem' }}>Fees</p>
          <div className="classroom-summary-tiles">
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">₹{board.totalExpected}</span>
              <span className="classroom-summary-label">Expected</span>
            </div>
            <div className="classroom-summary-tile tile-present">
              <span className="classroom-summary-value">₹{board.totalCollected}</span>
              <span className="classroom-summary-label">Collected</span>
            </div>
            <div className="classroom-summary-tile tile-absent">
              <span className="classroom-summary-value">₹{board.totalPending}</span>
              <span className="classroom-summary-label">Pending</span>
            </div>
          </div>
          <div className="classroom-summary-tiles">
            {tileDefs.map((t) => {
              const isSelected = selectedFilter === t.filter;
              return (
                <button
                  type="button"
                  key={t.filter}
                  className={`classroom-summary-tile classroom-summary-tile-clickable ${t.toneClass} ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={t.ariaLabel}
                  onClick={() => setSelectedFilter((cur) => (cur === t.filter ? null : t.filter))}
                >
                  <span className="classroom-summary-value">{t.value}</span>
                  <span className="classroom-summary-label">{t.label}</span>
                  <ChevronDown size={14} aria-hidden="true" className="classroom-summary-tile-chevron" />
                </button>
              );
            })}
          </div>

          {owing.length === 0 ? (
            <div className="classroom-empty">
              <span className="classroom-empty-icon" aria-hidden="true"><FileBarChart size={22} strokeWidth={1.8} /></span>
              <p className="library-empty-title">Everyone's paid up</p>
              <p className="library-empty-hint">No student owes money for {formatMonthLabel(period)}.</p>
            </div>
          ) : (
            <>
              <p className="classroom-hint">Students who still owe money this month:</p>
              <ul className="classroom-att-list">
                {owing.map((s) => (
                  <li key={s.studentId} className="classroom-att-row">
                    <div className="classroom-att-info">
                      <span className="classroom-att-name">{s.name}</span>
                      {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                    </div>
                    <div className="classroom-att-actions">
                      <span className={`classroom-att-btn ${s.status} active`} aria-hidden="true">
                        {feeBadgeText(s)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {selectedFilter !== null && board && (
        <FeeStatusModal
          title={modalTitle}
          period={period}
          students={modalStudents}
          toneClass={modalToneClass}
          onClose={() => setSelectedFilter(null)}
        />
      )}
    </div>
  );
}

function FeeStatusModal({
  title,
  period,
  students,
  toneClass,
  onClose,
}: {
  title: string;
  period: string;
  students: StudentFeeStatus[];
  toneClass: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="classroom-fee-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`classroom-fee-modal ${toneClass}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="classroom-fee-modal-head">
          <span className="classroom-fee-modal-title">{title} — {formatMonthLabel(period)}</span>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="classroom-fee-modal-body">
          {students.length === 0 ? (
            <div className="classroom-empty">
              <span className="classroom-empty-icon" aria-hidden="true"><FileBarChart size={22} strokeWidth={1.8} /></span>
              <p className="library-empty-title">No students in this category</p>
              <p className="library-empty-hint">No students match for {formatMonthLabel(period)}.</p>
            </div>
          ) : (
            <ul className="classroom-att-list">
              {students.map((s) => (
                <li key={s.studentId} className="classroom-att-row">
                  <div className="classroom-att-info">
                    <span className="classroom-att-name">{s.name}</span>
                    {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                  </div>
                  <div className="classroom-att-actions">
                    <span className={`classroom-att-btn ${s.status} active`} aria-hidden="true">
                      {feeBadgeText(s)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
