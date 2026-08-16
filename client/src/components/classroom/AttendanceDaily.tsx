import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, X as XIcon, ClipboardCheck } from 'lucide-react';
import { useToast } from '../Toast';
import { ApiError } from '../../api';
import { getDailyAttendance, saveAttendance } from '../../lib/classroomApi';
import { addDays, todayDateString } from '../../lib/classroomDate';
import type { AttendanceRosterEntry, AttendanceStatus } from '../../types';

const TODAY = todayDateString();

// Present/(Present+Absent)*100, unmarked excluded — the SAME formula as the
// server's classroomAttendance.js. Recomputed here only for instant visual
// feedback as the teacher taps, before anything is saved; the number that is
// actually persisted always comes back from the server on reload (§10: one
// implementation of the math server-side, this is a client-side preview of
// that same formula, not a second implementation of record).
function livePercentage(present: number, absent: number): number | null {
  const marked = present + absent;
  if (marked === 0) return null;
  return Math.round((present / marked) * 1000) / 10;
}

// One class + one date's roster-marking view (docs/classroom-feature-plan.md
// Phase 3). Owns its own working copy of statuses so taps are instant and
// batched into one bulk save, matching the server's bulk-upsert contract
// (§14) rather than firing one request per tap.
export default function AttendanceDaily({ classId, className }: { classId: string; className: string }) {
  const { show } = useToast();

  const [date, setDate] = useState(TODAY);
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getDailyAttendance(classId, date);
      setRoster(data.roster);
      setStatuses(new Map(data.roster.map((r) => [r.studentId, r.status])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    load();
  }, [load]);

  function setStatus(studentId: string, status: AttendanceStatus) {
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(studentId, status);
      return next;
    });
  }

  // Tapping the already-active state clears it back to Unmarked (§8) — the
  // only way to move a student off Present/Absent, mirroring how the server
  // treats a sent "unmarked" mark as "delete this row".
  function toggle(studentId: string, tapped: 'present' | 'absent') {
    setStatus(studentId, statuses.get(studentId) === tapped ? 'unmarked' : tapped);
  }

  const dirty = useMemo(
    () => roster.some((r) => (statuses.get(r.studentId) || 'unmarked') !== r.status),
    [roster, statuses]
  );

  const liveSummary = useMemo(() => {
    let present = 0;
    let absent = 0;
    for (const r of roster) {
      const s = statuses.get(r.studentId) || 'unmarked';
      if (s === 'present') present += 1;
      else if (s === 'absent') absent += 1;
    }
    return { present, absent, unmarked: roster.length - present - absent, percentage: livePercentage(present, absent) };
  }, [roster, statuses]);

  async function handleSave() {
    setSaving(true);
    try {
      const marks = roster.map((r) => ({ studentId: r.studentId, status: statuses.get(r.studentId) || 'unmarked' }));
      await saveAttendance(classId, date, marks);
      show('Attendance saved', 'success');
      await load(); // confirm what actually persisted, not just the local guess
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save attendance', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="classroom-attendance">
      <h2 className="classroom-panel-title">Attendance — {className}</h2>

      <div className="classroom-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous date" onClick={() => setDate((d) => addDays(d, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <input
          type="date"
          className="classroom-date-input"
          value={date}
          max={TODAY}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Attendance date"
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Next date"
          disabled={date >= TODAY}
          onClick={() => setDate((d) => addDays(d, 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {!loading && !error && (
        <div className="classroom-summary-tiles">
          <div className="classroom-summary-tile">
            <span className="classroom-summary-value">{roster.length}</span>
            <span className="classroom-summary-label">Students</span>
          </div>
          <div className="classroom-summary-tile tile-present">
            <span className="classroom-summary-value">{liveSummary.present}</span>
            <span className="classroom-summary-label">Present</span>
          </div>
          <div className="classroom-summary-tile tile-absent">
            <span className="classroom-summary-value">{liveSummary.absent}</span>
            <span className="classroom-summary-label">Absent</span>
          </div>
          <div className="classroom-summary-tile">
            <span className="classroom-summary-value">{liveSummary.unmarked}</span>
            <span className="classroom-summary-label">Unmarked</span>
          </div>
          <div className="classroom-summary-tile">
            <span className="classroom-summary-value">{liveSummary.percentage === null ? '—' : `${liveSummary.percentage}%`}</span>
            <span className="classroom-summary-label">Attendance</span>
          </div>
        </div>
      )}

      {loading && <p className="classroom-hint">Loading roster…</p>}
      {!loading && error && <p className="auth-error">{error}</p>}

      {!loading && !error && roster.length === 0 && (
        <div className="classroom-empty">
          <span className="classroom-empty-icon" aria-hidden="true"><ClipboardCheck size={22} strokeWidth={1.8} /></span>
          <p className="library-empty-title">No active students</p>
          <p className="library-empty-hint">Add students to this class first, from the Students tab.</p>
        </div>
      )}

      {!loading && !error && roster.length > 0 && (
        <>
          <ul className="classroom-att-list">
            {roster.map((r) => {
              const status = statuses.get(r.studentId) || 'unmarked';
              return (
                <li key={r.studentId} className="classroom-att-row">
                  <div className="classroom-att-info">
                    <span className="classroom-att-name">{r.name}</span>
                    {r.rollNumber && <span className="classroom-att-roll">Roll {r.rollNumber}</span>}
                  </div>
                  <div className="classroom-att-actions">
                    <button
                      type="button"
                      className={`classroom-att-btn present${status === 'present' ? ' active' : ''}`}
                      aria-pressed={status === 'present'}
                      aria-label={`Mark ${r.name} present`}
                      onClick={() => toggle(r.studentId, 'present')}
                    >
                      <Check size={15} aria-hidden="true" /> Present
                    </button>
                    <button
                      type="button"
                      className={`classroom-att-btn absent${status === 'absent' ? ' active' : ''}`}
                      aria-pressed={status === 'absent'}
                      aria-label={`Mark ${r.name} absent`}
                      onClick={() => toggle(r.studentId, 'absent')}
                    >
                      <XIcon size={15} aria-hidden="true" /> Absent
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="classroom-save-bar">
            <button type="button" className="btn-primary" disabled={saving || !dirty} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
