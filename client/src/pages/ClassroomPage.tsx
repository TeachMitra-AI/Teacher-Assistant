import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GraduationCap, FileBarChart, type LucideIcon } from 'lucide-react';
import TopBar from '../components/TopBar';
import ClassroomTabs, { type ClassroomTabKey } from '../components/classroom/ClassroomTabs';
import ClassList from '../components/classroom/ClassList';
import StudentRoster from '../components/classroom/StudentRoster';
import AttendancePanel from '../components/classroom/AttendancePanel';
import FeeStatusBoard from '../components/classroom/FeeStatusBoard';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import { ApiError } from '../api';
import { listClasses, createClass, updateClass, archiveClass, type CreateClassInput, type UpdateClassInput } from '../lib/classroomApi';
import type { SchoolClass } from '../types';

const TAB_KEYS: ClassroomTabKey[] = ['classes', 'students', 'attendance', 'fees', 'reports'];

function isTabKey(value: string | null): value is ClassroomTabKey {
  return value !== null && (TAB_KEYS as string[]).includes(value);
}

// A "coming soon" placeholder for the phases not built yet (Attendance,
// Fees, Reports/Analytics — docs/classroom-feature-plan.md §17 Phases 3-5).
// Routing/tab structure is final now; only the panel content lands later.
function ComingSoonPanel({ icon: Icon, title, selectedClassName }: { icon: LucideIcon; title: string; selectedClassName?: string }) {
  return (
    <div className="classroom-empty">
      <span className="classroom-empty-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
      <p className="library-empty-title">{title} coming soon</p>
      <p className="library-empty-hint">
        {selectedClassName
          ? `${title} for "${selectedClassName}" will appear here in a future update.`
          : `${title} will appear here in a future update.`}
      </p>
    </div>
  );
}

function SelectClassPrompt() {
  return (
    <div className="classroom-empty">
      <span className="classroom-empty-icon" aria-hidden="true"><GraduationCap size={22} strokeWidth={1.8} /></span>
      <p className="library-empty-title">Select a class</p>
      <p className="library-empty-hint">Choose a class from My Classes to continue.</p>
    </div>
  );
}

export default function ClassroomPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab: ClassroomTabKey = isTabKey(searchParams.get('tab')) ? (searchParams.get('tab') as ClassroomTabKey) : 'classes';
  const classId = searchParams.get('class');

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listClasses(true); // always fetch archived too; ClassList filters client-side
      setClasses(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setTab(next: ClassroomTabKey) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    });
  }

  function selectClass(id: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('class', id);
      // Selecting a class from My Classes is a dead end on its own — jump
      // straight to Students so the choice leads somewhere immediately,
      // matching §4's "Students/Attendance/Fees are always scoped to one
      // class at a time" mobile flow. A tab already showing class-scoped
      // content (Students/Attendance/Fees/Reports) is left as-is.
      if (!params.get('tab') || params.get('tab') === 'classes') params.set('tab', 'students');
      return params;
    });
  }

  async function handleCreate(input: CreateClassInput): Promise<boolean> {
    setCreating(true);
    try {
      const created = await createClass(input);
      setClasses((list) => [...list, created]);
      show('Class created', 'success');
      return true;
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not create class', 'error');
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string, input: UpdateClassInput): Promise<boolean> {
    try {
      const updated = await updateClass(id, input);
      setClasses((list) => list.map((c) => (c.id === id ? updated : c)));
      show('Class updated', 'success');
      return true;
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update class', 'error');
      return false;
    }
  }

  async function handleArchiveToggle(cls: SchoolClass): Promise<boolean> {
    try {
      const updated = await archiveClass(cls.id);
      setClasses((list) => list.map((c) => (c.id === updated.id ? updated : c)));
      show('Class archived', 'success');
      return true;
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not archive class', 'error');
      return false;
    }
  }

  const selectedClass = classId ? classes.find((c) => c.id === classId) || null : null;

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="classroom-main">
        <header className="library-header">
          <h1 className="library-title">Classroom</h1>
          <p className="library-subtitle">Manage your classes, students, attendance, fees, and reports.</p>
        </header>

        <ClassroomTabs active={tab} onSelect={setTab} />

        <div className="classroom-layout">
          <aside className={`classroom-sidebar${tab !== 'classes' ? ' mobile-hidden' : ''}`}>
            <ClassList
              classes={classes}
              loading={loading}
              error={error}
              selectedId={classId}
              showArchived={showArchived}
              creating={creating}
              onToggleShowArchived={() => setShowArchived((v) => !v)}
              onSelect={selectClass}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onArchiveToggle={handleArchiveToggle}
            />
          </aside>

          <section className={`classroom-content${tab === 'classes' ? ' mobile-hidden' : ''}`}>
            {tab === 'classes' && (
              <div className="classroom-empty classroom-desktop-only-hint">
                <span className="classroom-empty-icon" aria-hidden="true"><GraduationCap size={22} strokeWidth={1.8} /></span>
                <p className="library-empty-title">Choose a class</p>
                <p className="library-empty-hint">Select a class on the left, or a tab above, to get started.</p>
              </div>
            )}
            {tab === 'students' && (selectedClass ? <StudentRoster classId={selectedClass.id} className={selectedClass.name} /> : <SelectClassPrompt />)}
            {tab === 'attendance' && (
              selectedClass
                ? <AttendancePanel classId={selectedClass.id} className={selectedClass.name} />
                : <SelectClassPrompt />
            )}
            {tab === 'fees' && (
              selectedClass
                ? <FeeStatusBoard classId={selectedClass.id} className={selectedClass.name} />
                : <SelectClassPrompt />
            )}
            {tab === 'reports' && <ComingSoonPanel icon={FileBarChart} title="Reports & Analytics" selectedClassName={selectedClass?.name} />}
          </section>
        </div>
      </main>
    </div>
  );
}
