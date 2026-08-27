// Ported from client/src/lib/classroomApi.ts (docs/mobile-app-plan.md §9) —
// identical logic, only the import paths changed. Ownership is enforced
// server-side from the auth token, so nothing here sends a teacherId.
import { api } from './client';
import type {
  SchoolClass,
  Student,
  DailyAttendance,
  AttendanceStatus,
  ClassAttendanceMonthSummary,
  ClassAttendanceHistory,
  StudentAttendanceHistory,
  ClassFeeStatus,
  FeeRecordDto,
  ClassAnalytics,
  TeacherAnalyticsOverview,
} from '../types';

export interface CreateClassInput {
  name: string;
  grade?: string;
  section?: string;
}

export interface UpdateClassInput {
  name?: string;
  grade?: string;
  section?: string;
  archived?: boolean;
}

export async function listClasses(includeArchived = false): Promise<SchoolClass[]> {
  const qs = includeArchived ? '?includeArchived=true' : '';
  const data = await api<{ classes: SchoolClass[] }>(`/classroom/classes${qs}`);
  return data.classes;
}

export async function createClass(input: CreateClassInput): Promise<SchoolClass> {
  const data = await api<{ class: SchoolClass }>('/classroom/classes', { method: 'POST', body: input });
  return data.class;
}

export async function updateClass(id: string, input: UpdateClassInput): Promise<SchoolClass> {
  const data = await api<{ class: SchoolClass }>(`/classroom/classes/${id}`, { method: 'PATCH', body: input });
  return data.class;
}

// Soft-delete (archived: true) — never a hard delete, matching the server's
// own contract. Symmetric with updateClass(id, { archived: false }), which is
// how a class is restored.
export async function archiveClass(id: string): Promise<SchoolClass> {
  const data = await api<{ class: SchoolClass }>(`/classroom/classes/${id}`, { method: 'DELETE' });
  return data.class;
}

export interface CreateStudentInput {
  name: string;
  rollNumber?: string;
}

export interface UpdateStudentInput {
  name?: string;
  rollNumber?: string;
  active?: boolean;
}

export async function listStudents(classId: string, includeInactive = false): Promise<Student[]> {
  const qs = includeInactive ? '?includeInactive=true' : '';
  const data = await api<{ students: Student[] }>(`/classroom/classes/${classId}/students${qs}`);
  return data.students;
}

export async function addStudent(classId: string, input: CreateStudentInput): Promise<Student> {
  const data = await api<{ student: Student }>(`/classroom/classes/${classId}/students`, { method: 'POST', body: input });
  return data.student;
}

export async function updateStudent(studentId: string, input: UpdateStudentInput): Promise<Student> {
  const data = await api<{ student: Student }>(`/classroom/students/${studentId}`, { method: 'PATCH', body: input });
  return data.student;
}

// Soft-delete (active: false).
export async function deactivateStudent(studentId: string): Promise<Student> {
  const data = await api<{ student: Student }>(`/classroom/students/${studentId}`, { method: 'DELETE' });
  return data.student;
}

// ---- Attendance ------------------------------------------------------------

export async function getDailyAttendance(classId: string, date: string): Promise<DailyAttendance> {
  return api<DailyAttendance>(`/classroom/classes/${classId}/attendance?date=${date}`);
}

// Bulk upsert for one class + date — the server rejects the WHOLE batch if
// any studentId doesn't belong to this teacher's class, never a partial save.
export async function saveAttendance(
  classId: string,
  date: string,
  marks: { studentId: string; status: AttendanceStatus }[]
): Promise<{ date: string; saved: number }> {
  return api(`/classroom/classes/${classId}/attendance`, { method: 'POST', body: { date, marks } });
}

export async function getAttendanceMonthSummary(classId: string, month: string): Promise<ClassAttendanceMonthSummary> {
  return api<ClassAttendanceMonthSummary>(`/classroom/classes/${classId}/attendance/summary?month=${month}`);
}

// Day-by-day class totals for one month — powers the Monthly Summary
// screen's native calendar view (§13). Distinct from getAttendanceMonthSummary
// (per-student totals) — this is per-day.
export async function getClassAttendanceHistory(classId: string, month: string): Promise<ClassAttendanceHistory> {
  return api<ClassAttendanceHistory>(`/classroom/classes/${classId}/attendance/history?month=${month}`);
}

export async function getStudentAttendanceHistory(studentId: string, month: string): Promise<StudentAttendanceHistory> {
  return api<StudentAttendanceHistory>(`/classroom/students/${studentId}/attendance/history?month=${month}`);
}

// ---- Fees -------------------------------------------------------------------

export async function getFeeStatus(classId: string, period: string): Promise<ClassFeeStatus> {
  return api<ClassFeeStatus>(`/classroom/classes/${classId}/fees?period=${period}`);
}

// The client sends the amount actually paid so far this period — `status`
// (paid/partial/pending) is always derived server-side, never accepted from
// the client. One PATCH per save — there is no bulk fee-upsert endpoint
// (unlike attendance's day-at-a-time bulk save), so each tap is already
// exactly one intentional change, not a batchable series of taps against one
// save button.
export async function setFeeAmount(studentId: string, period: string, amount: number): Promise<FeeRecordDto> {
  const data = await api<{ fee: FeeRecordDto }>(`/classroom/students/${studentId}/fees/${period}`, {
    method: 'PATCH',
    body: { amount },
  });
  return data.fee;
}

// ---- Analytics ----------------------------------------------------------

// Current-month summary + fee snapshot for one class (Class Home's summary
// strip). NOT a "today" figure — see ClassAnalytics's own doc comment;
// callers wanting today's attendance specifically should pair this with
// getDailyAttendance(classId, todayIsoDate).summary instead.
export async function getClassAnalytics(classId: string): Promise<ClassAnalytics> {
  return api<ClassAnalytics>(`/classroom/analytics/classes/${classId}`);
}

// Teacher-wide (every class) totals for the Reports "All Classes" view —
// the one figure no per-class screen shows (today's attendance summed
// across every class, not just the one currently open).
export async function getTeacherAnalyticsOverview(): Promise<TeacherAnalyticsOverview> {
  return api<TeacherAnalyticsOverview>('/classroom/analytics/overview');
}
