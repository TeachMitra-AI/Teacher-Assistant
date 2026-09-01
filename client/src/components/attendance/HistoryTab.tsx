import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../auth';
import { ApiError } from '../../api';
import { getAttendanceHistory, getSchoolConfig, getHolidays } from '../../lib/teacherAttendanceApi';
import { addMonths, currentMonthString, formatMonthLabel, todayDateString } from '../../lib/classroomDate';
import { buildMonthDates, sinceDateFor, buildRows, summarizeRows, formatSummary, type HistoryRow } from '../../lib/teacherAttendanceCalendar';
import HistoryDayRow from './HistoryDayRow';
import MiniCalendarStrip from './MiniCalendarStrip';

const CURRENT_MONTH = currentMonthString();

export default function HistoryTab() {
  const { user } = useAuth();
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [records, config, holidays] = await Promise.all([
        getAttendanceHistory(month),
        getSchoolConfig(),
        getHolidays(),
      ]);
      // Without a config, weekly-off/holiday days can't be told apart from
      // a genuine Absent — fall back to only showing days that have a
      // record, same as before this feature existed, rather than mislabel
      // every missed day as Absent.
      const dates = config
        ? buildMonthDates(month, todayDateString(), sinceDateFor(config, user?.createdAt))
        : records.map((r) => r.date);
      setRows(buildRows(dates, records, config, holidays));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your attendance history.');
    } finally {
      setLoading(false);
    }
  }, [month, user?.createdAt]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="attendance-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="attendance-date-display">{formatMonthLabel(month)}</span>
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

      {loading && (
        <div className="run-skeleton" aria-label="Loading">
          <div className="sk-line" />
          <div className="sk-line" />
          <div className="sk-line" />
        </div>
      )}

      {!loading && error && (
        <div className="attendance-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="attendance-hint">No attendance recorded for this month.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <MiniCalendarStrip rows={rows} />
          <p className="attendance-summary">{formatSummary(summarizeRows(rows))}</p>
        </>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className="attendance-history-list">
          {rows.map((row) => (
            <HistoryDayRow key={row.date} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
