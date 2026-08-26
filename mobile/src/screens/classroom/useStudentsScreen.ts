// Owns the Students screen's state/API orchestration (docs/mobile-app-plan.md
// Phase 7c's "Screen -> useXScreen() -> state/API/business rules -> UI"
// convention). Phase 8 Step 3 scope: list + add + edit, over the already-
// ported classroomApi.{listStudents,addStudent,updateStudent} — no new API
// layer. Reuses the interaction pattern (not markup) of the web's
// StudentRoster.tsx: fetch-on-mount, optimistic list append/replace on a
// successful mutation, a per-mutation pending/error pair kept separate from
// the list's own loading/error so a failed add doesn't blank the roster
// underneath it. Deactivate/restore is deliberately out of scope this step
// (not in Step 3's enumerated scope) — listStudents is called active-only,
// matching listClasses' own default-active convention from Step 1.
import { useCallback, useEffect, useState } from 'react';
import { listStudents, addStudent, updateStudent } from '../../api/classroomApi';
import type { CreateStudentInput, UpdateStudentInput } from '../../api/classroomApi';
import { ApiError } from '../../api/client';
import type { Student } from '../../types';

interface StudentsScreenState {
  students: Student[];
  loading: boolean;
  error: string;
  reload: () => void;
  creating: boolean;
  createError: string;
  createStudent: (input: CreateStudentInput) => Promise<boolean>;
  savingEdit: boolean;
  editError: string;
  editStudent: (studentId: string, input: UpdateStudentInput) => Promise<boolean>;
}

export function useStudentsScreen(classId: string): StudentsScreenState {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listStudents(classId);
      setStudents(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load students.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    // Standard fetch-on-mount pattern — see useClassListScreen.ts's
    // identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const createStudent = useCallback(
    async (input: CreateStudentInput) => {
      setCreating(true);
      setCreateError('');
      try {
        const created = await addStudent(classId, input);
        setStudents((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
        return true;
      } catch (err) {
        setCreateError(err instanceof ApiError ? err.message : 'Could not add student.');
        return false;
      } finally {
        setCreating(false);
      }
    },
    [classId]
  );

  const editStudent = useCallback(async (studentId: string, input: UpdateStudentInput) => {
    setSavingEdit(true);
    setEditError('');
    try {
      const updated = await updateStudent(studentId, input);
      setStudents((list) => list.map((s) => (s.id === updated.id ? updated : s)).sort((a, b) => a.name.localeCompare(b.name)));
      return true;
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not update student.');
      return false;
    } finally {
      setSavingEdit(false);
    }
  }, []);

  return { students, loading, error, reload: load, creating, createError, createStudent, savingEdit, editError, editStudent };
}
