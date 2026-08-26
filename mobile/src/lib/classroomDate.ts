// Local-calendar date/month helpers for the Attendance UI (§13, ported from
// client/src/lib/classroomDate.ts). Deliberately built on the device's LOCAL
// calendar (getFullYear/getMonth/getDate), not UTC — a teacher tapping
// "Previous Date" expects yesterday on their own clock, and the server
// already treats "YYYY-MM-DD" as an opaque calendar-day key (see
// classroomAttendance.js's parseDateParam), so there is no UTC contract to
// stay aligned with here.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayDateString(): string {
  return toDateString(new Date());
}

export function parseDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, delta: number): string {
  const date = parseDateString(dateStr);
  date.setDate(date.getDate() + delta);
  return toDateString(date);
}

export function formatDateLabel(dateStr: string): string {
  return parseDateString(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function currentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function addMonths(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Number of calendar days in a YYYY-MM month — powers the Monthly Summary
// calendar grid's row count.
export function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// 0 (Sun) - 6 (Sat) for the 1st of the month — the calendar grid's leading
// blank-cell count.
export function firstWeekdayOfMonth(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}
