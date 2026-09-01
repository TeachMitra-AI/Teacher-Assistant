// Calendar-day math for HistoryTab's "show Absent days too" feature — kept
// separate from teacherAttendanceLabels.ts (pure formatting) since this is
// about which dates exist and what kind of day each one is, not how a
// value is displayed.
//
// buildRows/summarizeRows below started as HistoryTab.tsx-only helpers, then
// moved here once ReportsTab.tsx needed the exact same "fill every day,
// then count outcomes" logic per teacher instead of just for "yourself" —
// same reasoning as isWeeklyOffDate already living here rather than in the
// one component that first needed it.
import type { TeacherAttendanceDto, SchoolAttendanceConfigDto, SchoolHolidayDto } from '../types';
//
// Day-of-week here is computed from a plain "YYYY-MM-DD" string using the
// BROWSER's local calendar (new Date(y, m-1, d).getDay()), not IST — safe
// because a date string alone has no time-of-day component to convert:
// constructing and reading a Date in the same local frame never shifts
// which calendar day it lands on, regardless of what timezone the browser
// itself is in.

/** "YYYY-MM-DD" -> 0=Sunday..6=Saturday. */
function dateStringDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Is this date one of the school's weekly off days? `weeklyOffDays` is
 * SchoolAttendanceConfig's own comma-separated string ("0" or "0,6") —
 * mirrors lib/teacherAttendance.js's isWeeklyOff() parsing exactly
 * (including the same "empty string means none configured" guard against
 * Number('') === 0).
 */
export function isWeeklyOffDate(dateStr: string, weeklyOffDays: string): boolean {
  const offDays = weeklyOffDays
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d !== '')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return offDays.includes(dateStringDayOfWeek(dateStr));
}

/**
 * Every "YYYY-MM-DD" date in `month` ("YYYY-MM"), from the 1st up through
 * either the last day of the month or `throughDate` (today), whichever is
 * earlier — so a month in progress never lists days that haven't happened
 * yet, and a past month lists its full length.
 *
 * `sinceDate`, when given, is the earliest date attendance tracking could
 * possibly apply (the school's config creation date) — a month entirely
 * before it is skipped, and a month straddling it starts partway through,
 * so old months don't get "filled in" with Absent/Weekly-off days from
 * before the school even turned this feature on.
 */
export function buildMonthDates(month: string, throughDate: string, sinceDate?: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lastDay = month === throughDate.slice(0, 7) ? Number(throughDate.slice(8, 10)) : daysInMonth;

  let firstDay = 1;
  if (sinceDate) {
    const sinceMonth = sinceDate.slice(0, 7);
    if (month < sinceMonth) return [];
    if (month === sinceMonth) firstDay = Number(sinceDate.slice(8, 10));
  }

  const dates: string[] = [];
  for (let day = firstDay; day <= lastDay; day++) {
    dates.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

/**
 * The earliest date a month's "fill every day" calendar should ever cover —
 * the later of when the school's attendance settings were created and when
 * this specific person's own account was created, so neither a school that
 * just turned tracking on, nor a teacher who joined after that, sees Absent
 * for time before either existed. `undefined` when there's no config yet
 * (buildMonthDates callers should skip filling entirely in that case).
 */
export function sinceDateFor(config: SchoolAttendanceConfigDto | null, personCreatedAt: string | undefined): string | undefined {
  if (!config) return undefined;
  return [config.createdAt, personCreatedAt]
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop()!
    .slice(0, 10);
}

export interface HistoryRow {
  date: string;
  record: TeacherAttendanceDto | null;
  // Set only when there's no record AND it's not an ordinary missed day —
  // "Weekly off" or "Holiday — <reason>". Absent days have neither a
  // record nor this label.
  offLabel: string | null;
}

/**
 * Fills in every day of the month, not just the ones with a record — a day
 * with no check-in and no reason to be off is a genuine Absent.
 */
export function buildRows(
  dates: string[],
  records: TeacherAttendanceDto[],
  config: SchoolAttendanceConfigDto | null,
  holidays: SchoolHolidayDto[]
): HistoryRow[] {
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const holidayByDate = new Map(holidays.map((h) => [h.date, h]));

  return dates.map((date) => {
    const record = recordByDate.get(date) ?? null;
    if (record) return { date, record, offLabel: null };

    const holiday = holidayByDate.get(date);
    if (holiday) return { date, record: null, offLabel: `Holiday — ${holiday.reason}` };

    if (config && isWeeklyOffDate(date, config.weeklyOffDays)) {
      return { date, record: null, offLabel: 'Weekly off' };
    }

    return { date, record: null, offLabel: null }; // genuinely Absent
  });
}

export interface HistorySummary {
  present: number;
  absent: number;
  late: number; // subset of present — a late day counts in both
  half_day: number;
  on_leave: number;
  on_duty: number;
  flagged_review: number;
  pending_regularization: number;
}

export const SUMMARY_LABELS: [keyof HistorySummary, string][] = [
  ['present', 'Present'],
  ['absent', 'Absent'],
  ['late', 'Late'],
  ['half_day', 'Half day'],
  ['on_leave', 'On leave'],
  ['on_duty', 'On duty'],
  ['flagged_review', 'Needs review'],
  ['pending_regularization', 'Missing checkout'],
];

/** Weekly-off/holiday days are never counted — they're not an attendance outcome. */
export function summarizeRows(rows: HistoryRow[]): HistorySummary {
  const summary: HistorySummary = {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    on_leave: 0,
    on_duty: 0,
    flagged_review: 0,
    pending_regularization: 0,
  };
  for (const row of rows) {
    if (!row.record) {
      if (!row.offLabel) summary.absent += 1;
      continue;
    }
    summary[row.record.status as keyof typeof summary] =
      (summary[row.record.status as keyof typeof summary] ?? 0) + 1;
    if (row.record.lateMinutes) summary.late += 1;
  }
  return summary;
}

/** "22 Present · 2 Absent · 1 Late" — only categories that actually occurred, in a fixed reading order. */
export function formatSummary(summary: HistorySummary): string {
  return SUMMARY_LABELS.filter(([key]) => summary[key] > 0)
    .map(([key, label]) => `${summary[key]} ${label}`)
    .join(' · ');
}
