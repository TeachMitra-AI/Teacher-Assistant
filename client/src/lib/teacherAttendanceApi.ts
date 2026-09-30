// Typed client for the Teacher Attendance API (docs/feature-teacher-attendance-implementation-plan.md). Thin wrappers over
// api(), mirroring lib/classroomApi.ts; scoping is enforced server-side from the token, so nothing here sends a userId or
// schoolId. Covers what's built so far; further wrappers land with the pages that use them.
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

// A blocked check-in (too far, or outside the window; checkout only checks distance) comes back as a plain 403 ApiError
// with a readable message, so callers just try/catch it like any rejected action.
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

// ---- Corrections (school_admin only) ----
// There's no review queue (nothing auto-flags a day), so reviewAttendance is reachable on any day from the Reports drill-down.

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

// ---- School config + holidays ----
// Viewing (GET) is open to any authenticated teacher; editing (PUT/POST) is school_admin only, matching the server routes.

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

// Readable by any authenticated teacher: the server lets a teacher see their own school's holiday list.
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

/** Today's counts across the school, for the Reports tab's dashboard cards. */
export async function getTodaySummary(): Promise<TeacherAttendanceTodaySummary> {
  return api<TeacherAttendanceTodaySummary>('/teacher-attendance/today-summary');
}

// ---- Whole-school report (school_admin only) ----

/**
 * The Reports list: summary counts only, paginated, so a large school doesn't load every teacher's full month. Per-teacher
 * detail is a separate call below.
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

/** One teacher's day-by-day records for a month, the Reports drill-down. */
export async function getTeacherAttendanceDetail(userId: string, month: string): Promise<TeacherAttendanceDetailPage> {
  return api<TeacherAttendanceDetailPage>(
    `/teacher-attendance/school-history/${userId}?month=${encodeURIComponent(month)}`
  );
}

// ---- Activity log (school_admin only) ----
// A recent window by default server-side, never "everything". Every filter is optional; omitting all just narrows to `days`.

export async function getActivityLog(
  options: {
    days?: number;
    page?: number;
    pageSize?: number;
    userId?: string;
    action?: string;
    // 'teacher' = a person's own day (check-ins, blocked attempts, reminders); 'admin' = housekeeping (settings, holiday
    // edits, corrections). Lets the client filter out one category.
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

// Same download approach as classroomApi.ts's downloadFeesReport: a Bearer-token GET can't be a plain <a href>, so it
// fetches the blob and clicks a throwaway object-URL anchor.
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
