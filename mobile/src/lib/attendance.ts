// Pure attendance-marking logic shared by useMarkAttendanceScreen and its
// tests (§13, §4.3 — ported verbatim from
// client/src/components/classroom/AttendanceDaily.tsx:17-21,55-68,70-84).
// This is a client-side PREVIEW of the server's own formula
// (server/src/lib/classroomAttendance.js:23-27) for instant optimistic UI
// feedback only — the number that is actually persisted always comes back
// from the server on reload. Never a second, independent aggregation
// implementation of record.
import type { AttendanceRosterEntry, AttendanceStatus } from '../types';

export function attendancePercentage(present: number, absent: number): number | null {
  const marked = present + absent;
  if (marked === 0) return null;
  return Math.round((present / marked) * 1000) / 10;
}

// Tapping the already-active state clears it back to Unmarked — the only way
// to move a student off Present/Absent, mirroring how the server treats a
// sent "unmarked" mark as "delete this row".
export function toggleStatus(current: AttendanceStatus, tapped: 'present' | 'absent'): AttendanceStatus {
  return current === tapped ? 'unmarked' : tapped;
}

// Dirty = at least one row's working status differs from what was loaded
// from the server. Drives the Save button's disabled state — nothing is
// persisted until this is true and "Save Attendance" is tapped.
export function computeDirty(roster: AttendanceRosterEntry[], statuses: Map<string, AttendanceStatus>): boolean {
  return roster.some((r) => (statuses.get(r.studentId) || 'unmarked') !== r.status);
}

export interface LiveAttendanceSummary {
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
}

export function computeLiveSummary(
  roster: AttendanceRosterEntry[],
  statuses: Map<string, AttendanceStatus>
): LiveAttendanceSummary {
  let present = 0;
  let absent = 0;
  for (const r of roster) {
    const s = statuses.get(r.studentId) || 'unmarked';
    if (s === 'present') present += 1;
    else if (s === 'absent') absent += 1;
  }
  return {
    present,
    absent,
    unmarked: roster.length - present - absent,
    percentage: attendancePercentage(present, absent),
  };
}

// The exact payload shape POST .../attendance expects — every roster row,
// unmarked included (an "unmarked" mark tells the server to delete that
// student's row for the date, per markAttendanceSchema's own comment).
export function buildSaveMarks(
  roster: AttendanceRosterEntry[],
  statuses: Map<string, AttendanceStatus>
): { studentId: string; status: AttendanceStatus }[] {
  return roster.map((r) => ({ studentId: r.studentId, status: statuses.get(r.studentId) || 'unmarked' }));
}
