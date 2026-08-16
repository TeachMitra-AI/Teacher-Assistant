import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FileBarChart } from 'lucide-react';
import { ApiError } from '../../api';
import { getAttendanceMonthSummary, getStudentAttendanceHistory } from '../../lib/classroomApi';
import { addMonths, currentMonthString, formatDateLabel, formatMonthLabel } from '../../lib/classroomDate';
import type { ClassAttendanceMonthSummary, StudentAttendanceHistory } from '../../types';

const CURRENT_MONTH = currentMonthString();

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

// One class's month-wise attendance (docs/classroom-feature-plan.md Phase 3
// "Month-wise attendance" + "Student attendance history"). Per-student rows
// come straight from GET .../attendance/summary — the expandable date list
// per student is the only extra fetch, done lazily on expand rather than
// eagerly for every student up front.
export default function AttendanceMonthly({ classId, className }: { classId: string; className: string }) {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [summary, setSummary] = useState<ClassAttendanceMonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<StudentAttendanceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAttendanceMonthSummary(classId, month);
      setSummary(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the monthly summary.');
    } finally {
      setLoading(false);
    }
  }, [classId, month]);

  useEffect(() => {
    load();
    setExpandedId(null); // a student expanded for the last month isn't meaningful for this one
  }, [load]);

  async function toggleExpand(studentId: string) {
    if (expandedId === studentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(studentId);
    setHistory(null);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const data = await getStudentAttendanceHistory(studentId, month);
      setHistory(data);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : 'Could not load attendance history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="classroom-attendance">
      <h2 className="classroom-panel-title">Monthly Attendance — {className}</h2>

      <div className="classroom-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="classroom-date-display">{formatMonthLabel(month)}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next month"
          disabled={month >= CURRENT_MONTH}
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && <p className="classroom-hint">Loading monthly summary…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && summary && (
        <>
          <div className="classroom-summary-tiles">
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">{summary.totalStudents}</span>
              <span className="classroom-summary-label">Total Students</span>
            </div>
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">{summary.daysMarked}</span>
              <span className="classroom-summary-label">Days Marked</span>
            </div>
            <div className="classroom-summary-tile tile-present">
              <span className="classroom-summary-value">{summary.present}</span>
              <span className="classroom-summary-label">Present</span>
            </div>
            <div className="classroom-summary-tile tile-absent">
              <span className="classroom-summary-value">{summary.absent}</span>
              <span className="classroom-summary-label">Absent</span>
            </div>
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">{summary.unmarked}</span>
              <span className="classroom-summary-label">Unmarked</span>
            </div>
            <div className="classroom-summary-tile">
              <span className="classroom-summary-value">{pct(summary.percentage)}</span>
              <span className="classroom-summary-label">Average Attendance</span>
            </div>
          </div>

          {summary.perStudent.length === 0 && (
            <div className="classroom-empty">
              <span className="classroom-empty-icon" aria-hidden="true"><FileBarChart size={22} strokeWidth={1.8} /></span>
              <p className="library-empty-title">No active students</p>
              <p className="library-empty-hint">Add students to this class first, from the Students tab.</p>
            </div>
          )}

          {summary.perStudent.length > 0 && (
            <ul className="classroom-att-list">
              {summary.perStudent.map((s) => {
                const isExpanded = expandedId === s.studentId;
                return (
                  <li key={s.studentId} className="classroom-history-item">
                    <button
                      type="button"
                      className="classroom-history-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpand(s.studentId)}
                    >
                      <span className="classroom-att-info">
                        <span className="classroom-att-name">{s.name}</span>
                        {s.rollNumber && <span className="classroom-att-roll">Roll {s.rollNumber}</span>}
                      </span>
                      <span className="classroom-history-stats">
                        <span className="tile-present">{s.present}P</span>
                        <span className="tile-absent">{s.absent}A</span>
                        <span>{s.unmarked}U</span>
                        <span className="classroom-history-pct">{pct(s.percentage)}</span>
                        {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="classroom-history-detail">
                        {historyLoading && <p className="classroom-hint">Loading history…</p>}
                        {!historyLoading && historyError && <p className="auth-error">{historyError}</p>}
                        {!historyLoading && !historyError && history && history.days.length === 0 && (
                          <p className="classroom-hint">No attendance recorded for {s.name} this month.</p>
                        )}
                        {!historyLoading && !historyError && history && history.days.length > 0 && (
                          <ul className="classroom-history-days">
                            {history.days.map((d) => (
                              <li key={d.date} className={`classroom-history-day ${d.status}`}>
                                {formatDateLabel(d.date)} — {d.status === 'present' ? 'Present' : 'Absent'}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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
