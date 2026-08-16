import { useState, type FormEvent } from 'react';
import { Pencil, Archive, RotateCcw, Check, X, GraduationCap } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import { GRADES } from '../../config';
import type { SchoolClass } from '../../types';
import type { CreateClassInput, UpdateClassInput } from '../../lib/classroomApi';

interface ClassListProps {
  classes: SchoolClass[];
  loading: boolean;
  error: string;
  selectedId: string | null;
  showArchived: boolean;
  creating: boolean;
  onToggleShowArchived: () => void;
  onSelect: (id: string) => void;
  onCreate: (input: CreateClassInput) => Promise<boolean>;
  onUpdate: (id: string, input: UpdateClassInput) => Promise<boolean>;
  onArchiveToggle: (cls: SchoolClass) => Promise<boolean>;
}

const FORM_DEFAULTS = { name: '', grade: '', section: '' };

export default function ClassList({
  classes,
  loading,
  error,
  selectedId,
  showArchived,
  creating,
  onToggleShowArchived,
  onSelect,
  onCreate,
  onUpdate,
  onArchiveToggle,
}: ClassListProps) {
  const [form, setForm] = useState(FORM_DEFAULTS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(FORM_DEFAULTS);
  const [savingEdit, setSavingEdit] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<SchoolClass | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const ok = await onCreate({
      name: form.name.trim(),
      grade: form.grade.trim() || undefined,
      section: form.section.trim() || undefined,
    });
    if (ok) setForm(FORM_DEFAULTS);
  }

  function startEdit(cls: SchoolClass) {
    setEditingId(cls.id);
    setEditForm({ name: cls.name, grade: cls.grade || '', section: cls.section || '' });
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) return;
    setSavingEdit(true);
    const ok = await onUpdate(id, {
      name: editForm.name.trim(),
      grade: editForm.grade.trim() || undefined,
      section: editForm.section.trim() || undefined,
    });
    setSavingEdit(false);
    if (ok) setEditingId(null);
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    const ok = await onArchiveToggle(archiveTarget);
    setArchiving(false);
    if (ok) setArchiveTarget(null);
  }

  const visible = showArchived ? classes : classes.filter((c) => !c.archived);

  return (
    <div className="classroom-classlist">
      <form className="school-form" onSubmit={handleCreate}>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Class name (e.g. Class 5-A)"
          maxLength={200}
          aria-label="New class name"
        />
        <input
          list="classroom-grades"
          value={form.grade}
          onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
          placeholder="Grade (optional)"
          maxLength={60}
          aria-label="New class grade"
        />
        <input
          value={form.section}
          onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
          placeholder="Section (optional)"
          maxLength={60}
          aria-label="New class section"
        />
        <button type="submit" className="btn-primary" disabled={creating || !form.name.trim()}>
          {creating ? 'Adding…' : 'Add class'}
        </button>
        <datalist id="classroom-grades">{GRADES.map((g) => <option key={g} value={g} />)}</datalist>
      </form>

      <label className="classroom-show-archived">
        <input type="checkbox" checked={showArchived} onChange={onToggleShowArchived} />
        Show archived classes
      </label>

      {loading && <p className="classroom-hint">Loading your classes…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="classroom-empty">
          <span className="classroom-empty-icon" aria-hidden="true"><GraduationCap size={22} strokeWidth={1.8} /></span>
          {classes.length === 0 ? (
            <>
              <p className="library-empty-title">No classes yet</p>
              <p className="library-empty-hint">Add your first class above to get started.</p>
            </>
          ) : (
            // Reachable only when every existing class is archived and
            // showArchived is off — NOT "you've never created a class"
            // (you have; that's why this view is empty).
            <>
              <p className="library-empty-title">No active classes</p>
              <p className="library-empty-hint">Toggle "Show archived classes" above to see your archived ones.</p>
            </>
          )}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="classroom-class-list">
          {visible.map((cls) => {
            const isEditing = editingId === cls.id;
            return (
              <li key={cls.id} className={`classroom-class-item${selectedId === cls.id ? ' active' : ''}${cls.archived ? ' archived' : ''}`}>
                {isEditing ? (
                  <div className="classroom-class-edit">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Class name"
                      maxLength={200}
                      aria-label="Edit class name"
                    />
                    <input
                      list="classroom-grades"
                      value={editForm.grade}
                      onChange={(e) => setEditForm((f) => ({ ...f, grade: e.target.value }))}
                      placeholder="Grade"
                      maxLength={60}
                      aria-label="Edit class grade"
                    />
                    <input
                      value={editForm.section}
                      onChange={(e) => setEditForm((f) => ({ ...f, section: e.target.value }))}
                      placeholder="Section"
                      maxLength={60}
                      aria-label="Edit class section"
                    />
                    <div className="classroom-class-edit-actions">
                      <button type="button" className="icon-btn" title="Save" aria-label="Save" disabled={savingEdit} onClick={() => saveEdit(cls.id)}>
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel" disabled={savingEdit} onClick={() => setEditingId(null)}>
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="classroom-class-item-main" onClick={() => onSelect(cls.id)}>
                      <span className="classroom-class-name">{cls.name}</span>
                      <span className="classroom-class-meta">
                        {[cls.grade, cls.section].filter(Boolean).join(' · ') || 'No grade/section set'}
                      </span>
                      {cls.archived && <span className="classroom-badge-archived">Archived</span>}
                    </button>
                    <div className="classroom-class-actions">
                      <button type="button" className="icon-btn" title="Rename" aria-label={`Rename ${cls.name}`} onClick={() => startEdit(cls)}>
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      {cls.archived ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Restore"
                          aria-label={`Restore ${cls.name}`}
                          onClick={() => onUpdate(cls.id, { archived: false })}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Archive"
                          aria-label={`Archive ${cls.name}`}
                          onClick={() => setArchiveTarget(cls)}
                        >
                          <Archive size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive this class?"
        body={`"${archiveTarget?.name}" will move out of your active classes. Its students, attendance, and fee history are kept, and you can restore it any time.`}
        confirmLabel="Archive"
        busy={archiving}
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
