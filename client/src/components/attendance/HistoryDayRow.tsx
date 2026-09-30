import type { ReactNode } from 'react';
import { formatDateLabel } from '../../lib/classroomDate';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatDuration } from '../../lib/teacherAttendanceLabels';
import type { HistoryRow } from '../../lib/teacherAttendanceCalendar';
import type { TeacherAttendanceDto } from '../../types';

// A "Late"/"Short" annotation was plain text at the same weight as "Present" and easy to skim past. It's highlighted to read
// "worth a second look" without the alarm of the red Absent/Needs-review styling reserved for serious cases.
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

// One day's row in a "fill every day of the month" list, shared by HistoryTab (a teacher's own month) and ReportsTab's
// drill-down (the Principal's view). `action`, when given, renders after the status (the Principal's "Correct" trigger);
// it's omitted for a teacher's own HistoryTab.
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
