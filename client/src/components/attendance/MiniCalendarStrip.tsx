import type { HistoryRow } from '../../lib/teacherAttendanceCalendar';

// The "shape of the month at a glance" strip from
// docs/attendance-register-design.html — a colour-coded grid above the
// detail list, so a pattern (mostly green, one amber day) reads in half a
// second, before anyone reads a single row. Shared by HistoryTab (a
// teacher's own month) and ReportsTab's drill-down (the Principal's view
// of someone else's).
const WEEKDAY_HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function cellClass(row: HistoryRow): string {
  if (row.record) {
    if (row.record.status === 'absent') return 'absent';
    if (row.record.status === 'flagged_review' || row.record.status === 'pending_regularization') return 'warning';
    if (row.record.lateMinutes || (row.record.shortfallMinutes ?? 0) > 0) return 'warning';
    return 'present';
  }
  if (row.offLabel) return 'off';
  return 'absent'; // no record, no reason to be off — genuinely absent
}

export default function MiniCalendarStrip({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) return null;
  // Local calendar date (no time-of-day component), same convention
  // teacherAttendanceCalendar.ts's own day-of-week helper uses — safe
  // because a "YYYY-MM-DD" string has nothing to convert across timezones.
  const [y, m, d] = rows[0].date.split('-').map(Number);
  const firstWeekday = new Date(y, m - 1, d).getDay();

  return (
    <div className="attendance-cal-strip" role="img" aria-label="This month at a glance">
      {WEEKDAY_HEADS.map((label, i) => (
        <span key={`head-${i}`} className="attendance-cal-head">{label}</span>
      ))}
      {Array.from({ length: firstWeekday }).map((_, i) => (
        <span key={`lead-${i}`} className="attendance-cal-cell attendance-cal-empty" />
      ))}
      {rows.map((row) => (
        <span key={row.date} className={`attendance-cal-cell attendance-cal-${cellClass(row)}`} title={row.date}>
          {Number(row.date.slice(-2))}
        </span>
      ))}
    </div>
  );
}
