// Calendar-day math for HistoryTab's "show Absent days too": which dates exist and what kind of day each is, kept apart from
// teacherAttendanceLabels.ts (formatting). buildRows/summarizeRows live here because ReportsTab needed the same "fill every
// day, then count outcomes" per teacher.
import type { TeacherAttendanceDto, SchoolAttendanceConfigDto, SchoolHolidayDto } from '../types';
//
// Day-of-week is computed from a plain "YYYY-MM-DD" using the browser's local calendar (new Date(y, m-1, d).getDay()); with
// no time-of-day involved, that never shifts the calendar day whatever the timezone.

/** "YYYY-MM-DD" -> 0=Sunday..6=Saturday. */
function dateStringDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Is this date a weekly off day? `weeklyOffDays` is SchoolAttendanceConfig's comma-separated string ("0" or "0,6"); parsing mirrors isWeeklyOff() in lib/teacherAttendance.js, including the empty-string guard against Number('') === 0. */
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
 * Every "YYYY-MM-DD" date in `month` from the 1st through the month end or `throughDate` (today), whichever is earlier.
 * `sinceDate` is the earliest date tracking could apply (the school's config creation date): a month before it is skipped and
 * one straddling it starts partway, so old months aren't filled with Absent/Weekly-off days from before the feature was on.
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
 * The earliest date the fill-every-day calendar should cover: the later of the school's settings creation and this person's
 * account creation, so neither shows Absent for time before it existed. `undefined` when there's no config yet (callers
 * skip filling).
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
  // Set only when there's no record and it isn't an ordinary missed day: "Weekly off" or "Holiday — <reason>".
  offLabel: string | null;
}

/** Fills in every day of the month, not just those with a record; a day with no check-in and no reason to be off is a genuine Absent. */
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

/** Weekly-off and holiday days aren't an attendance outcome, so they're never counted. */
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
