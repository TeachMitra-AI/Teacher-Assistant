import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Pencil, UserX, RotateCcw, Check, X } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { listStudents, addStudent, updateStudent, deactivateStudent } from '../../lib/classroomApi';
import type { Student } from '../../types';

const FORM_DEFAULTS = { name: '', rollNumber: '' };

// Students for ONE selected class (docs/classroom-feature-plan.md §9).
// Owns its own data — reloaded whenever `classId` changes (switching the
// selected class is a fresh roster, not a filter on one shared list).
export default function StudentRoster({ classId, className }: { classId: string; className: string }) {
  const { show } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState(FORM_DEFAULTS);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(FORM_DEFAULTS);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Student | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Always fetch including inactive students; the "Show inactive" toggle
      // below filters client-side, so switching it never needs a round trip.
      const list = await listStudents(classId, true);
      setStudents(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load students.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
    // Reset transient UI state when switching classes — an edit/create form
    // left open for the previous class must not silently apply to this one.
    setForm(FORM_DEFAULTS);
    setEditingId(null);
    setDeactivateTarget(null);
  }, [classId, load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const created = await addStudent(classId, { name: form.name.trim(), rollNumber: form.rollNumber.trim() || undefined });
      setStudents((list) => [...list, created]);
      setForm(FORM_DEFAULTS);
      show('Student added', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not add student', 'error');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(student: Student) {
    setEditingId(student.id);
    setEditForm({ name: student.name, rollNumber: student.rollNumber || '' });
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await updateStudent(id, { name: editForm.name.trim(), rollNumber: editForm.rollNumber.trim() || undefined });
      setStudents((list) => list.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
      show('Student updated', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update student', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function restore(student: Student) {
    try {
      const updated = await updateStudent(student.id, { active: true });
      setStudents((list) => list.map((s) => (s.id === student.id ? updated : s)));
      show('Student restored', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not restore student', 'error');
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      const updated = await deactivateStudent(deactivateTarget.id);
      setStudents((list) => list.map((s) => (s.id === updated.id ? updated : s)));
      show('Student deactivated', 'success');
      setDeactivateTarget(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not deactivate student', 'error');
    } finally {
      setDeactivating(false);
    }
  }

  const visible = showInactive ? students : students.filter((s) => s.active);

  return (
    <div className="classroom-roster">
      <h2 className="classroom-panel-title">Students — {className}</h2>

      <form className="school-form" onSubmit={handleAdd}>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Student name"
          maxLength={200}
          aria-label="New student name"
        />
        <input
          value={form.rollNumber}
          onChange={(e) => setForm((f) => ({ ...f, rollNumber: e.target.value }))}
          placeholder="Roll number (optional)"
          maxLength={60}
          aria-label="New student roll number"
        />
        <button type="submit" className="btn-primary" disabled={creating || !form.name.trim()}>
          {creating ? 'Adding…' : 'Add student'}
        </button>
      </form>

      <label className="classroom-show-archived">
        <input type="checkbox" checked={showInactive} onChange={() => setShowInactive((v) => !v)} />
        Show deactivated students
      </label>

      {loading && <p className="classroom-hint">Loading roster…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Roll No.</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={3} className="table-empty">
                  {students.length === 0
                    ? 'No students yet — add your first one above.'
                    // Reachable only when every existing student is inactive
                    // and showInactive is off (visible = active-only in that
                    // case) — NOT "no deactivated students exist" (there is
                    // at least one, that's why this view is empty).
                    : 'No active students — toggle "Show deactivated students" to see them.'}
                </td></tr>
              )}
              {visible.map((student) => {
                const isEditing = editingId === student.id;
                return (
                  <tr key={student.id} className={student.active ? '' : 'classroom-row-inactive'}>
                    {isEditing ? (
                      <>
                        <td>
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            maxLength={200}
                            aria-label="Edit student name"
                          />
                        </td>
                        <td>
                          <input
                            value={editForm.rollNumber}
                            onChange={(e) => setEditForm((f) => ({ ...f, rollNumber: e.target.value }))}
                            maxLength={60}
                            aria-label="Edit student roll number"
                          />
                        </td>
                        <td>
                          <button type="button" className="icon-btn" title="Save" aria-label="Save" disabled={savingEdit} onClick={() => saveEdit(student.id)}>
                            <Check size={14} aria-hidden="true" />
                          </button>{' '}
                          <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel" disabled={savingEdit} onClick={() => setEditingId(null)}>
                            <X size={14} aria-hidden="true" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{student.name}{!student.active && <span className="classroom-badge-archived">Inactive</span>}</td>
                        <td>{student.rollNumber || '—'}</td>
                        <td>
                          <button type="button" className="icon-btn" title="Edit" aria-label={`Edit ${student.name}`} onClick={() => startEdit(student)}>
                            <Pencil size={14} aria-hidden="true" />
                          </button>{' '}
                          {student.active ? (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Deactivate"
                              aria-label={`Deactivate ${student.name}`}
                              onClick={() => setDeactivateTarget(student)}
                            >
                              <UserX size={14} aria-hidden="true" />
                            </button>
                          ) : (
                            <button type="button" className="icon-btn" title="Restore" aria-label={`Restore ${student.name}`} onClick={() => restore(student)}>
                              <RotateCcw size={14} aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        title="Deactivate this student?"
        body={`"${deactivateTarget?.name}" will be hidden from the active roster. Their attendance and fee history are kept, and you can restore them any time.`}
        confirmLabel="Deactivate"
        busy={deactivating}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
