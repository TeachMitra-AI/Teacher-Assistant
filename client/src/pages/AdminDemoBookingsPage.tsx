import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import TablePager from '../components/TablePager';
import { usePagedList } from '../hooks/usePagedList';
import { usePreferences } from '../hooks/usePreferences';
import { listDemoBookings, type AdminDemoBooking } from '../lib/adminScheduleDemo';

// Read-only admin inbox for Schedule a Call bookings — see
// docs/schedule-a-call-plan.md. No mutation UI: cancelling/rescheduling is
// visitor-token-driven (the emailed manage link), matching the server
// route's own "visibility only" scope (routes/adminScheduleDemo.js).
const STATUS_LABELS = { confirmed: 'Confirmed', cancelled: 'Cancelled' } as const;
const STATUSES = Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[];

export default function AdminDemoBookingsPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const [statusFilter, setStatusFilter] = useState<'confirmed' | 'cancelled' | ''>('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const fetchBookings = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listDemoBookings({ page, limit, q, status: statusFilter, from: fromFilter, to: toFilter }),
    [statusFilter, fromFilter, toFilter]
  );
  const bookings = usePagedList<AdminDemoBooking>(fetchBookings, `${statusFilter}|${fromFilter}|${toFilter}`);

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Schedule a Call — Bookings</h1>
        <AdminTabs />

        <section className="manage-section">
          <div className="table-controls">
            <div className="library-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={bookings.search}
                onChange={(e) => bookings.setSearch(e.target.value)}
                placeholder="Search name, email, or organization"
                aria-label="Search bookings"
              />
            </div>
            <div className="table-filters">
              <label className="table-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'confirmed' | 'cancelled' | '')}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
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
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Organization</th>
                  <th>Role</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {bookings.loading && (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      Loading…
                    </td>
                  </tr>
                )}
                {!bookings.loading && bookings.error && (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      {bookings.error}
                    </td>
                  </tr>
                )}
                {!bookings.loading && !bookings.error && bookings.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      {bookings.isFiltering ? 'No bookings match your search or filters.' : 'No bookings yet.'}
                    </td>
                  </tr>
                )}
                {!bookings.loading &&
                  !bookings.error &&
                  bookings.items.map((b) => (
                    <tr key={b.id}>
                      <td>{b.date}</td>
                      <td>{b.timeLabel}</td>
                      <td>
                        <span className={`status-pill status-${b.status}`}>{STATUS_LABELS[b.status]}</span>
                      </td>
                      <td>{b.name}</td>
                      <td>{b.email}</td>
                      <td>{b.organization}</td>
                      <td>{b.role}</td>
                      <td className="ticket-summary-cell">{b.notes || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <TablePager
            noun={{ one: 'booking', many: 'bookings' }}
            page={bookings.page}
            totalPages={bookings.totalPages}
            total={bookings.total}
            rangeStart={bookings.rangeStart}
            rangeEnd={bookings.rangeEnd}
            hasPrev={bookings.hasPrev}
            hasNext={bookings.hasNext}
            onPageChange={bookings.setPage}
            busy={bookings.loading}
          />
        </section>
      </main>
    </div>
  );
}
