import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Search,
  LogIn,
  LogOut,
  Ban,
  Pencil,
  Palmtree,
  Briefcase,
  CalendarDays,
  Settings as SettingsIcon,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '../../api';
import { getActivityLog } from '../../lib/teacherAttendanceApi';
import type { TeacherAttendanceActivityLogEntry } from '../../types';

// The who/what/when/where/result feed
// (docs/feature-teacher-attendance-implementation-plan.md §1.10) — a
// secondary, investigative tab, not the Principal's daily-use screen
// (that's Reports).
//
// Rebuilt as a connected timeline (the pattern GitHub/Linear/Stripe use for
// an activity/audit feed) after the flat-list version still read as one
// undifferentiated block once real housekeeping noise (settings/holiday
// edits) mixed in with actual teacher activity. Three real changes, not
// just more colour:
//   1. A summary strip up top answers "how much happened, and of what
//      kind" before anyone reads a single row.
//   2. A real segmented control for category, not a loose row of chips —
//      "Teacher activity" now visibly reads as ONE choice among three, not
//      an equal peer of the day-range buttons next to it.
//   3. Events connect into a single line per day, the way a timeline reads
//      instead of a table — the icon carries the "kind" of event, the line
//      itself carries the passage of time.
const PAGE_SIZE = 25;
const DAY_OPTIONS = [7, 30, 90];

type Tone = 'routine' | 'warning' | 'admin';
type Category = 'all' | 'teacher' | 'admin';

const ACTION_META: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  login: { label: 'Logged in', icon: LogIn, tone: 'routine' },
  check_in: { label: 'Checked in', icon: LogIn, tone: 'routine' },
  check_out: { label: 'Checked out', icon: LogOut, tone: 'routine' },
  check_in_blocked: { label: 'Check-in blocked', icon: Ban, tone: 'warning' },
  check_out_blocked: { label: 'Checkout blocked', icon: Ban, tone: 'warning' },
  reminder_sent: { label: 'Checkout reminder sent', icon: Bell, tone: 'routine' },
  correction: { label: 'Correction', icon: Pencil, tone: 'admin' },
  mark_on_leave: { label: 'Marked on leave', icon: Palmtree, tone: 'admin' },
  mark_on_duty: { label: 'Marked on duty', icon: Briefcase, tone: 'admin' },
  holiday_changed: { label: 'Holiday changed', icon: CalendarDays, tone: 'admin' },
  settings_changed: { label: 'Settings changed', icon: SettingsIcon, tone: 'admin' },
};

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'teacher', label: 'Teacher activity' },
  { value: 'admin', label: 'Admin actions' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateGroupKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ActivityLogTab() {
  const [days, setDays] = useState(7);
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<TeacherAttendanceActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The at-a-glance counts across the whole window (independent of the
  // category filter/search currently applied to the list below) — "how
  // much happened, and of what kind" before scrolling anything. Cheap:
  // each call asks for pageSize:1 purely to read back its `total`.
  const [summary, setSummary] = useState<{ total: number; teacher: number; admin: number; blocked: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [all, teacher, admin, blockedIn, blockedOut] = await Promise.all([
          getActivityLog({ days, pageSize: 1 }),
          getActivityLog({ days, category: 'teacher', pageSize: 1 }),
          getActivityLog({ days, category: 'admin', pageSize: 1 }),
          getActivityLog({ days, action: 'check_in_blocked', pageSize: 1 }),
          getActivityLog({ days, action: 'check_out_blocked', pageSize: 1 }),
        ]);
        if (!cancelled) {
          setSummary({ total: all.total, teacher: teacher.total, admin: admin.total, blocked: blockedIn.total + blockedOut.total });
        }
      } catch {
        if (!cancelled) setSummary(null); // the summary strip is a nicety — a failure here shouldn't block the list below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getActivityLog({
        days,
        page,
        pageSize: PAGE_SIZE,
        category: category === 'all' ? undefined : category,
        search: search.trim() || undefined,
      });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the activity log.');
    } finally {
      setLoading(false);
    }
  }, [days, page, category, search]);

  useEffect(() => {
    // A short debounce on search — a keystroke shouldn't fire a fresh query on every character.
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [days, category, search]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: TeacherAttendanceActivityLogEntry[] }>();
    for (const e of entries) {
      const key = dateGroupKey(e.createdAt);
      if (!map.has(key)) map.set(key, { label: dateGroupLabel(e.createdAt), items: [] });
      map.get(key)!.items.push(e);
    }
    return Array.from(map.values());
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <p className="attendance-hint">
        Every check-in, check-out, blocked attempt, and correction, for later lookup — not something you need to review daily.
      </p>

      {summary && summary.total > 0 && (
        <div className="attendance-activity-summary">
          <span className="attendance-activity-summary-item">
            <strong>{summary.total}</strong> events
          </span>
          <span className="attendance-activity-summary-item tone-routine">
            <strong>{summary.teacher}</strong> teacher activity
          </span>
          <span className="attendance-activity-summary-item tone-admin">
            <strong>{summary.admin}</strong> admin actions
          </span>
          {summary.blocked > 0 && (
            <span className="attendance-activity-summary-item tone-warning">
              <strong>{summary.blocked}</strong> blocked attempts
            </span>
          )}
        </div>
      )}

      <div className="attendance-activity-toolbar">
        <div className="attendance-review-search attendance-activity-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="text-input"
            type="search"
            placeholder="Search by teacher name"
            aria-label="Search by teacher name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="attendance-activity-segmented" role="group" aria-label="Filter by category">
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={category === c.value ? 'active' : ''}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="attendance-activity-chips">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`attendance-activity-chip${days === d ? ' active' : ''}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="run-skeleton" aria-label="Loading">
          <div className="sk-line" />
          <div className="sk-line" />
          <div className="sk-line" />
        </div>
      )}

      {!loading && error && (
        <div className="attendance-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="attendance-hint">
          {search.trim() ? `No activity for "${search.trim()}" in this window.` : 'No activity in this window.'}
        </p>
      )}

      {!loading && !error && groups.length > 0 && (
        <>
          <div className="attendance-activity-timeline">
            {groups.map((group) => (
              <div key={group.label + group.items[0].id} className="attendance-activity-day">
                <span className="attendance-activity-day-label">{group.label}</span>
                <ul className="attendance-activity-events">
                  {group.items.map((e) => {
                    const meta = ACTION_META[e.action] ?? { label: e.action, icon: Bell, tone: 'routine' as Tone };
                    const Icon = meta.icon;
                    return (
                      <li key={e.id} className={`attendance-activity-event tone-${meta.tone}`}>
                        <span className="attendance-activity-dot">
                          <Icon size={14} aria-hidden="true" />
                        </span>
                        <span className="attendance-activity-content">
                          <p className="attendance-activity-primary">
                            <b>{e.userName ?? 'Unknown'}</b> {meta.label}
                          </p>
                          {e.result && <p className="attendance-activity-secondary">{e.result}</p>}
                        </span>
                        <time className="attendance-activity-time">{formatTime(e.createdAt)}</time>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="attendance-reports-pagination">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="attendance-reports-pagination-btns">
              <button type="button" className="btn-text" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button type="button" className="btn-text" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
