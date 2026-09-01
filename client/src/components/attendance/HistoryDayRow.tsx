import type { ReactNode } from 'react';
import { formatDateLabel } from '../../lib/classroomDate';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatDuration } from '../../lib/teacherAttendanceLabels';
import type { HistoryRow } from '../../lib/teacherAttendanceCalendar';
import type { TeacherAttendanceDto } from '../../types';

// A "Late"/"Short" annotation used to be plain text, the same visual weight
// as an ordinary "Present" — easy to skim right past. Highlighted here so
// it reads as "worth a second look" without being as alarming as the red
// Absent/Needs-review styling, which is reserved for the more serious cases.
function recordDetail(day: TeacherAttendanceDto) {
  const flags: string[] = [];
  if (day.lateMinutes) flags.push(`Late ${formatDuration(day.lateMinutes)}`);
  if (day.shortfallMinutes) flags.push(`Short ${formatDuration(day.shortfallMinutes)}`);
  if (flags.length === 0) return TEACHER_ATTENDANCE_STATUS_LABEL[day.status];
  return (
    <>
      {TEACHER_ATTENDANCE_STATUS_LABEL[day.status]}
      {flags.map((flag) => (
        <span key={flag} className="attendance-history-flag"> · {flag}</span>
      ))}
    </>
  );
}

// One day's row in a "fill every day of the month" list — shared by
// HistoryTab (a teacher's own month) and ReportsTab's per-teacher drill-down
// (the Principal's view of someone else's month), pulled out once both
// needed the exact same markup plus the Principal's review reason.
// `action`, when given, renders after the status — the Principal's
// on-demand "Correct" trigger in ReportsTab's drill-down. Omitted (the
// default) for a teacher's own HistoryTab, which has no such action.
export default function HistoryDayRow({ row, action }: { row: HistoryRow; action?: ReactNode }) {
  return (
    <li className="attendance-history-row">
      <div className="attendance-history-row-main">
        <span className="attendance-history-date">{formatDateLabel(row.date)}</span>
        <span className={`attendance-history-status${!row.record && !row.offLabel ? ' attendance-history-absent' : ''}`}>
          {row.record ? recordDetail(row.record) : row.offLabel ?? 'Absent'}
        </span>
        {action}
      </div>
      {row.record?.reviewReason && (
        <p className="attendance-history-reason">Principal: &ldquo;{row.record.reviewReason}&rdquo;</p>
      )}
    </li>
  );
}
