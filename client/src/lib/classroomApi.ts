// Typed client for the Classroom Management API
// (docs/classroom-feature-plan.md). Thin wrappers over api(), mirroring
// lib/resources.ts's shape — ownership is enforced server-side from the auth
// token, so nothing here sends a teacherId.
//
// Phase 2 scope: classes + students. Phase 3 adds attendance below.
// Fees/analytics/export wrappers land alongside the phases that use them
// (§17), rather than being stubbed out ahead of use.
import { api } from '../api';
import type {
  SchoolClass,
  Student,
  DailyAttendance,
  AttendanceStatus,
  ClassAttendanceMonthSummary,
  StudentAttendanceHistory,
  ClassFeeStatus,
  FeeStatus,
  FeeRecordDto,
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

// ---- Attendance (Phase 3) --------------------------------------------------

export async function getDailyAttendance(classId: string, date: string): Promise<DailyAttendance> {
  return api<DailyAttendance>(`/classroom/classes/${classId}/attendance?date=${date}`);
}

// Bulk upsert for one class + date — the server rejects the WHOLE batch if
// any studentId doesn't belong to this teacher's class (§14), never a
// partial save.
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

export async function getStudentAttendanceHistory(studentId: string, month: string): Promise<StudentAttendanceHistory> {
  return api<StudentAttendanceHistory>(`/classroom/students/${studentId}/attendance/history?month=${month}`);
}

// ---- Fees (Phase 4) ---------------------------------------------------------

export async function getFeeStatus(classId: string, period: string): Promise<ClassFeeStatus> {
  return api<ClassFeeStatus>(`/classroom/classes/${classId}/fees?period=${period}`);
}

// One PATCH per status change — there is no bulk fee-upsert endpoint (unlike
// attendance's day-at-a-time bulk save), so each tap is already exactly one
// intentional change, not a batchable series of taps against one save button.
export async function setFeeStatus(studentId: string, period: string, status: FeeStatus): Promise<FeeRecordDto> {
  const data = await api<{ fee: FeeRecordDto }>(`/classroom/students/${studentId}/fees/${period}`, {
    method: 'PATCH',
    body: { status },
  });
  return data.fee;
}
