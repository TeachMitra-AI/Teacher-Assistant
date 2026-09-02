// Typed client for the Teacher Attendance API
// (docs/feature-teacher-attendance-implementation-plan.md §3). Thin wrappers
// over api(), mirroring lib/classroomApi.ts's shape — ownership/scoping is
// enforced server-side from the auth token, so nothing here sends a userId
// or schoolId.
//
// Scoped to what's built so far (check-in/out, today, history) — the
// review-queue, school-config, and holiday wrappers land alongside the
// pages that use them, same "not stubbed out ahead of use" convention
// classroomApi.ts's own header comment describes.
import { api, apiDownload } from '../api';
import type {
  TeacherAttendanceDto,
  TeacherAttendanceDetailPage,
  TeacherAttendanceReviewInput,
  SchoolAttendanceConfigDto,
  SchoolAttendanceConfigInput,
  SchoolHolidayDto,
  CreateHolidayInput,
  NonWorkingDayInfo,
  SchoolHistoryPage,
  TeacherAttendanceActivityLogPage,
  TeacherAttendanceTodaySummary,
} from '../types';

export interface AttendanceEvidenceInput {
  lat: number;
  lon: number;
  accuracyMeters: number;
  deviceId?: string;
}

export interface AttendanceActionResult {
  attendance: TeacherAttendanceDto;
}

// Blocked (too far, or outside the check-in window — checkout has no
// time-of-day gate, only distance) now comes back as a plain ApiError (403)
// with a human-readable message — there is no longer a "succeeded but
// flagged" outcome to check for separately, so callers just try/catch this
// like any other rejected action.
export async function checkIn(input: AttendanceEvidenceInput): Promise<AttendanceActionResult> {
  return api<AttendanceActionResult>('/teacher-attendance/check-in', { method: 'POST', body: input });
}

export async function checkOut(input: AttendanceEvidenceInput): Promise<AttendanceActionResult> {
  return api<AttendanceActionResult>('/teacher-attendance/check-out', { method: 'POST', body: input });
}

export interface TodayAttendanceResult {
  attendance: TeacherAttendanceDto | null;
  nonWorkingDay: NonWorkingDayInfo | null;
}

export async function getTodayAttendance(): Promise<TodayAttendanceResult> {
  return api<TodayAttendanceResult>('/teacher-attendance/today');
}

/** @param month "YYYY-MM" */
export async function getAttendanceHistory(month: string): Promise<TeacherAttendanceDto[]> {
  const data = await api<{ month: string; attendance: TeacherAttendanceDto[] }>(
    `/teacher-attendance/history?month=${encodeURIComponent(month)}`
  );
  return data.attendance;
}

// ---- Corrections (school_admin only) ---------------------------------------
//
// No review-queue endpoint any more — nothing auto-flags a day for
// approval, so there was nothing left to queue
// (docs/feature-teacher-attendance-implementation-plan.md §1.7/§4).
// reviewAttendance is now reachable on any day from the Reports drill-down.

export async function reviewAttendance(
  id: string,
  input: TeacherAttendanceReviewInput
): Promise<TeacherAttendanceDto> {
  const data = await api<{ attendance: TeacherAttendanceDto }>(`/teacher-attendance/${id}/review`, {
    method: 'POST',
    body: input,
  });
  return data.attendance;
}

// ---- School config + holidays ------------------------------------------------
// Viewing (GET) is open to any authenticated teacher; editing (PUT/POST) is
// school_admin only — matches the server routes exactly.

export async function getSchoolConfig(): Promise<SchoolAttendanceConfigDto | null> {
  const data = await api<{ config: SchoolAttendanceConfigDto | null }>('/teacher-attendance/school-config');
  return data.config;
}

export async function updateSchoolConfig(input: SchoolAttendanceConfigInput): Promise<SchoolAttendanceConfigDto> {
  const data = await api<{ config: SchoolAttendanceConfigDto }>('/teacher-attendance/school-config', {
    method: 'PUT',
    body: input,
  });
  return data.config;
}

// Readable by any authenticated teacher (not admin-only) — matches the
// server route, which lets a teacher see their own school's holiday list.
export async function getHolidays(): Promise<SchoolHolidayDto[]> {
  const data = await api<{ holidays: SchoolHolidayDto[] }>('/teacher-attendance/holidays');
  return data.holidays;
}

export async function createHoliday(input: CreateHolidayInput): Promise<SchoolHolidayDto> {
  const data = await api<{ holiday: SchoolHolidayDto }>('/teacher-attendance/holidays', {
    method: 'POST',
    body: input,
  });
  return data.holiday;
}

export async function updateHoliday(id: string, input: CreateHolidayInput): Promise<SchoolHolidayDto> {
  const data = await api<{ holiday: SchoolHolidayDto }>(`/teacher-attendance/holidays/${id}`, {
    method: 'PUT',
    body: input,
  });
  return data.holiday;
}

export async function deleteHoliday(id: string): Promise<void> {
  await api<null>(`/teacher-attendance/holidays/${id}`, { method: 'DELETE' });
}

/** Today's counts across the school — the Reports tab's dashboard cards. */
export async function getTodaySummary(): Promise<TeacherAttendanceTodaySummary> {
  return api<TeacherAttendanceTodaySummary>('/teacher-attendance/today-summary');
}

// ---- Whole-school report (school_admin only) ----------------------------------

/**
 * The Reports list — summary counts only, paginated
 * (docs/feature-teacher-attendance-implementation-plan.md §7: a school with
 * many teachers can't have every teacher's full month loaded just to show a
 * count). A specific teacher's day-by-day detail is a separate call, below.
 * @param month "YYYY-MM"
 */
export async function getSchoolHistory(
  month: string,
  options: { page?: number; pageSize?: number; search?: string } = {}
): Promise<SchoolHistoryPage> {
  const params = new URLSearchParams({ month });
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.search) params.set('search', options.search);
  return api<SchoolHistoryPage>(`/teacher-attendance/school-history?${params.toString()}`);
}

/** One teacher's real day-by-day records for a month — the Reports drill-down's detail fetch. */
export async function getTeacherAttendanceDetail(userId: string, month: string): Promise<TeacherAttendanceDetailPage> {
  return api<TeacherAttendanceDetailPage>(
    `/teacher-attendance/school-history/${userId}?month=${encodeURIComponent(month)}`
  );
}

// ---- Activity log (school_admin only) --------------------------------------
//
// Defaults to a recent window server-side, never "everything" — see the
// plan's §7. Every filter is optional; omitting all of them just narrows to
// `days`.

export async function getActivityLog(
  options: {
    days?: number;
    page?: number;
    pageSize?: number;
    userId?: string;
    action?: string;
    // 'teacher' = a person's own day (check-ins, blocked attempts,
    // reminders) — 'admin' = administrative housekeeping (settings/holiday
    // edits, corrections). Lets the client filter out one category instead
    // of forcing everything into one flat feed.
    category?: 'teacher' | 'admin';
    search?: string;
  } = {}
): Promise<TeacherAttendanceActivityLogPage> {
  const params = new URLSearchParams();
  if (options.days) params.set('days', String(options.days));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.userId) params.set('userId', options.userId);
  if (options.action) params.set('action', options.action);
  if (options.category) params.set('category', options.category);
  if (options.search) params.set('search', options.search);
  const query = params.toString();
  return api<TeacherAttendanceActivityLogPage>(`/teacher-attendance/activity-log${query ? `?${query}` : ''}`);
}

// Same download approach as classroomApi.ts's downloadFeesReport — a
// Bearer-token GET can't be a plain <a href>, so this fetches the blob and
// clicks a throwaway object-URL anchor.
export async function downloadSchoolAttendanceReport(month: string): Promise<void> {
  const { blob, filename } = await apiDownload(
    `/teacher-attendance/school-history/export?month=${encodeURIComponent(month)}`
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `attendance-${month}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
