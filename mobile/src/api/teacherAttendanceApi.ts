// Typed client for the Teacher Attendance API — native port of
// client/src/lib/teacherAttendanceApi.ts. Thin wrappers over api(),
// ownership/scoping is enforced server-side from the auth token, so nothing
// here sends a userId or schoolId.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api, ApiError } from './client';
import { getToken } from './session';
import { SharingUnavailableError } from '../lib/exportPdf';
import { API_BASE } from '../config';
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

// Blocked (too far, or outside the check-in window) comes back as a plain
// ApiError (403) with a human-readable message — callers just try/catch this
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

/** Today's counts across the school — the Reports screen's dashboard cards. */
export async function getTodaySummary(): Promise<TeacherAttendanceTodaySummary> {
  return api<TeacherAttendanceTodaySummary>('/teacher-attendance/today-summary');
}

// ---- Whole-school report (school_admin only) ----------------------------------

/** @param month "YYYY-MM" */
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

export async function getActivityLog(
  options: {
    days?: number;
    page?: number;
    pageSize?: number;
    userId?: string;
    action?: string;
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

// Mirrors classroomApi.ts's downloadFeesReport — an .xlsx workbook, not
// JSON, so this bypasses api()'s JSON-only client and hands the downloaded
// file to the native share sheet instead of the web's browser-download
// trigger.
export async function downloadSchoolAttendanceReport(month: string): Promise<void> {
  const token = await getToken();
  const dest = `${FileSystem.cacheDirectory}attendance-${month}.xlsx`;
  const result = await FileSystem.downloadAsync(
    `${API_BASE}/teacher-attendance/school-history/export?month=${encodeURIComponent(month)}`,
    dest,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status !== 200) {
    throw new ApiError('Could not download the report.', result.status);
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new SharingUnavailableError();
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: `Attendance report — ${month}`,
  });
}
