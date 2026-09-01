// Shared plain-language presentation helpers for Teacher Attendance — used
// across CheckInTab, HistoryTab, and AttendanceCorrectionForm, kept in one
// place so wording/formatting can never drift between "today's status", "a
// past day's status", and "the Principal's view of the same day".
import type { TeacherAttendanceStatus } from '../types';

export const TEACHER_ATTENDANCE_STATUS_LABEL: Record<TeacherAttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
  on_duty: 'On duty',
  pending_regularization: 'Missing checkout',
  flagged_review: 'Needs review',
};

export function formatAttendanceTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 420 -> "7h", 65 -> "1h 5m", 45 -> "45m", 0 -> "0m". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || Number.isNaN(minutes) || minutes < 0) return '—';
  if (minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** 600 -> "600m" (stays metres under 1km), 1600 -> "1.6km", 2000 -> "2km" (no trailing .0). */
export function formatDistance(meters: number | null): string {
  if (meters === null || Number.isNaN(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = Math.round((meters / 1000) * 10) / 10;
  return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)}km`;
}
