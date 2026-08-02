import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import TablePager from '../components/TablePager';
import { usePagedList } from '../hooks/usePagedList';
import { usePreferences } from '../hooks/usePreferences';
import { listSupportTickets, getSupportTicketStats } from '../lib/adminSupport';
import { listAdminSchools } from '../lib/admin';
import { BUG_CATEGORIES, FEEDBACK_CATEGORIES } from '../config';
import type {
  AdminSchool, SupportTicketStats, SupportTicketStatus, SupportTicketSummary, SupportTicketType,
} from '../types';

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open', triaged: 'Triaged', resolved: 'Resolved', wont_fix: "Won't fix",
};
const STATUSES = Object.keys(STATUS_LABELS) as SupportTicketStatus[];

const TYPE_LABELS: Record<SupportTicketType, string> = { bug: 'Bug', feedback: 'Feedback' };
const TYPES = Object.keys(TYPE_LABELS) as SupportTicketType[];

// Relative time for the list's "Created" column — the detail page (Phase 2.3)
// shows the exact timestamp; the list only needs a scannable approximation.
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminSupportPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const navigate = useNavigate();

  const [stats, setStats] = useState<SupportTicketStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSupportTicketStats().then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Populates the School filter dropdown. A one-off fetch at a generous page
  // size, not a searchable picker — fine while school counts stay small (see
  // the design doc's own honest caveat); a school-count-heavy deployment
  // would need a combobox here instead.
  const [schools, setSchools] = useState<AdminSchool[]>([]);
  useEffect(() => {
    let cancelled = false;
    listAdminSchools({ limit: 100 }).then((res) => { if (!cancelled) setSchools(res.items); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<SupportTicketType | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  // Category has no single cross-type vocabulary (bug and feedback each have
  // their own — see config.ts's BUG_CATEGORIES/FEEDBACK_CATEGORIES), so the
  // dropdown only offers options once a Type is chosen, and changing Type
  // clears whatever category was selected for the other one.
  const categoryOptions = typeFilter === 'bug' ? BUG_CATEGORIES : typeFilter === 'feedback' ? FEEDBACK_CATEGORIES : [];
  function handleTypeChange(value: SupportTicketType | '') {
    setTypeFilter(value);
    setCategoryFilter('');
  }

  const fetchTickets = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listSupportTickets({
        page, limit, q,
        status: statusFilter, type: typeFilter, category: categoryFilter,
        schoolId: schoolFilter, from: fromFilter, to: toFilter,
      }),
    [statusFilter, typeFilter, categoryFilter, schoolFilter, fromFilter, toFilter]
  );
  // Any change to this key resets the table to page 1 (see usePagedList).
  const tickets = usePagedList<SupportTicketSummary>(
    fetchTickets,
    `${statusFilter}|${typeFilter}|${categoryFilter}|${schoolFilter}|${fromFilter}|${toFilter}`
  );

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Support Inbox</h1>
        <AdminTabs />

        {stats && (
          <section className="kpi-grid">
            <div className="kpi-card"><span className="kpi-value">{stats.open}</span><span className="kpi-label">Open</span></div>
            <div className="kpi-card"><span className="kpi-value">{stats.today}</span><span className="kpi-label">Today</span></div>
            <div className="kpi-card"><span className="kpi-value">{stats.bugs} : {stats.feedback}</span><span className="kpi-label">Bugs : Feedback</span></div>
          </section>
        )}

        <section className="manage-section">
          <div className="table-controls">
            <div className="library-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={tickets.search}
                onChange={(e) => tickets.setSearch(e.target.value)}
                placeholder="Search description, reporter, or reference"
                aria-label="Search support tickets"
              />
            </div>
            <div className="table-filters">
              <label className="table-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as SupportTicketStatus | '')}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>Type</span>
                <select
                  value={typeFilter}
                  onChange={(e) => handleTypeChange(e.target.value as SupportTicketType | '')}
                  aria-label="Filter by type"
                >
                  <option value="">All types</option>
                  {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>Category</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  disabled={!typeFilter}
                  aria-label="Filter by category"
                >
                  <option value="">{typeFilter ? 'All categories' : 'Choose a type first'}</option>
                  {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>School</span>
                <select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)} aria-label="Filter by school">
                  <option value="">All schools</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>From</span>
                <input type="date" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} aria-label="From date" />
              </label>
              <label className="table-filter">
                <span>To</span>
                <input type="date" value={toFilter} onChange={(e) => setToFilter(e.target.value)} aria-label="To date" />
              </label>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref</th><th>Type</th><th>Category</th><th>Status</th><th>School</th><th>Reported by</th><th>Summary</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.loading && (
                  <tr><td colSpan={8} className="table-empty">Loading…</td></tr>
                )}
                {!tickets.loading && tickets.error && (
                  <tr><td colSpan={8} className="table-empty">{tickets.error}</td></tr>
                )}
                {!tickets.loading && !tickets.error && tickets.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      {tickets.isFiltering ? 'No tickets match your search or filters.' : 'No tickets yet.'}
                    </td>
                  </tr>
                )}
                {!tickets.loading && !tickets.error && tickets.items.map((t) => (
                  <tr
                    key={t.id}
                    className="ticket-row"
                    onClick={() => navigate(`/admin/support/${t.id}`)}
                    tabIndex={0}
                    role="link"
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/support/${t.id}`); }}
                  >
                    <td className="ticket-ref">#{t.id.slice(-8)}</td>
                    <td><span className={`type-tag type-${t.type}`}>{TYPE_LABELS[t.type]}</span></td>
                    <td>{t.category || '—'}</td>
                    <td><span className={`status-pill status-${t.status}`}>{STATUS_LABELS[t.status]}</span></td>
                    <td>{t.school?.name || '—'}</td>
                    <td>{t.user?.name || '—'}</td>
                    <td className="ticket-summary-cell">{t.description || '—'}</td>
                    <td>{relativeTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            noun={{ one: 'ticket', many: 'tickets' }}
            page={tickets.page}
            totalPages={tickets.totalPages}
            total={tickets.total}
            rangeStart={tickets.rangeStart}
            rangeEnd={tickets.rangeEnd}
            hasPrev={tickets.hasPrev}
            hasNext={tickets.hasNext}
            onPageChange={tickets.setPage}
            busy={tickets.loading}
          />
        </section>
      </main>
    </div>
  );
}
