import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileBarChart } from 'lucide-react';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { getFeeStatus, downloadFeesReport } from '../../lib/classroomApi';
import { addMonths, currentMonthString, formatMonthLabel } from '../../lib/classroomDate';
import type { ClassFeeStatus } from '../../types';

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

  const owing = board ? board.perStudent.filter((s) => s.status !== 'paid') : [];
  const totalPending = board ? Math.max(board.totalExpected - board.totalCollected, 0) : 0;

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
      {!loading && error && <p className="auth-error">{error}</p>}

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
              <span className="classroom-summary-value">₹{totalPending}</span>
              <span className="classroom-summary-label">Pending</span>
            </div>
          </div>
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
                {owing.map((s) => {
                  const owed = s.expectedAmount != null ? s.expectedAmount - s.amount : null;
                  return (
                    <li key={s.studentId} className="classroom-att-row">
                      <div className="classroom-att-info">
                        <span className="classroom-att-name">{s.name}</span>
                        {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                      </div>
                      <div className="classroom-att-actions">
                        <span className={`classroom-att-btn ${s.status} active`} aria-hidden="true">
                          {owed != null ? `Owes ₹${owed}` : 'No fee amount set'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
