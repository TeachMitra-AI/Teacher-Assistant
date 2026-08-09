import { useCallback, useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import TablePager from '../components/TablePager';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import { usePagedList } from '../hooks/usePagedList';
import {
  changeUserRole,
  createSchool as createSchoolApi,
  decidePendingUser,
  listAdminSchools,
  listAdminUsers,
  listPendingUsers,
} from '../lib/admin';
import { roleChangeConfirmation } from '../lib/roleChange';
import { ROLE_LABELS } from '../config';
import type { AdminSchool, AdminUser, Role, UserStatus } from '../types';

const ROLES: Role[] = ['teacher', 'school_admin', 'resource_person', 'super_admin'];
const STATUSES: UserStatus[] = ['active', 'pending', 'rejected'];

const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  rejected: 'Rejected',
};

export default function ManagePage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user } = useAuth();
  const { show } = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  // Every admin role can SEE the pending queue; only these two may decide on
  // it, matching the server's gate on approve/reject. A resource_person gets
  // read-only visibility.
  const canDecide = user?.role === 'school_admin' || user?.role === 'super_admin';

  // --- Users table: server-side search + role/status filters + pagination ---
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');

  const fetchUsers = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listAdminUsers({ page, limit, q, role: roleFilter, status: statusFilter }),
    [roleFilter, statusFilter]
  );
  // Any change to this key resets the table to page 1 (see usePagedList).
  const users = usePagedList<AdminUser>(fetchUsers, `${roleFilter}|${statusFilter}`);

  // --- Pending queue ---
  const fetchPending = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listPendingUsers({ page, limit, q }),
    []
  );
  const pending = usePagedList<AdminUser>(fetchPending, '');

  // --- Schools table (super_admin only) ---
  const fetchSchools = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      isSuperAdmin ? listAdminSchools({ page, limit, q }) : Promise.resolve({ items: [], total: 0, page: 1, limit }),
    [isSuperAdmin]
  );
  const schools = usePagedList<AdminSchool>(fetchSchools, '');

  // New-school form state.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');
  const [creating, setCreating] = useState(false);

  async function createSchool(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || code.trim().length < 3) {
      show('Enter a name and a code of at least 3 characters', 'error');
      return;
    }
    setCreating(true);
    try {
      await createSchoolApi({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        district: district.trim() || undefined,
        state: state.trim() || undefined,
      });
      setName(''); setCode(''); setDistrict(''); setState('');
      show('School created', 'success');
      // Refetch rather than unshifting the new row: with server-side paging
      // the new school belongs wherever the sort and the current search put
      // it, and `total` has to move with it.
      await schools.refetch();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not create school', 'error');
    } finally {
      setCreating(false);
    }
  }

  // Approve/reject. The row is patched for instant feedback, then both lists
  // are refetched — an approved teacher leaves the pending queue and joins
  // the users table, which changes the totals and the page boundaries of
  // both. Local array surgery cannot express that correctly once the lists
  // are paginated, so it is not attempted.
  async function decide(target: AdminUser, action: 'approve' | 'reject') {
    pending.patchItem(
      (u) => u.id === target.id,
      (u) => ({ ...u, status: action === 'approve' ? 'active' : 'rejected' })
    );
    try {
      await decidePendingUser(target.id, action);
      show(action === 'approve' ? `${target.name} approved` : `${target.name} rejected`, 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Could not ${action} this teacher`, 'error');
    } finally {
      // Runs on success and failure: on failure this is what restores the
      // row to its true server-side state.
      await Promise.all([pending.refetch(), users.refetch()]);
    }
  }

  // A role change is never applied straight from the <select>. Picking an
  // option only stages the change here; the dialog below is what commits it.
  // The row itself is NOT patched optimistically the way approve/reject is —
  // the select keeps showing the user's real current role until the server
  // confirms, which is what makes Cancel a no-op with nothing to roll back.
  const [pendingRole, setPendingRole] = useState<{ target: AdminUser; role: Role } | null>(null);
  const [applyingRole, setApplyingRole] = useState(false);

  function requestRoleChange(target: AdminUser, role: Role) {
    // Re-selecting the role a user already has is not a change worth
    // confirming (and the server would reject it as a no-op anyway).
    if (role === target.role) return;
    setPendingRole({ target, role });
  }

  async function confirmRoleChange() {
    if (!pendingRole) return;
    const { target, role } = pendingRole;
    setApplyingRole(true);
    try {
      await changeUserRole(target.id, role);
      show('Role updated', 'success');
      setPendingRole(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update role', 'error');
      // The dialog closes on failure too: the message is in the toast, and
      // leaving a modal up over a table the user now needs to re-read is
      // worse than dismissing it.
      setPendingRole(null);
    } finally {
      setApplyingRole(false);
      // Runs either way. A role change can move the row out of the current
      // view when a role filter is active, and on failure this is what proves
      // the select is still showing the true server-side role.
      await users.refetch();
    }
  }

  const roleConfirm = pendingRole
    ? roleChangeConfirmation(pendingRole.target.role, pendingRole.role, pendingRole.target.name)
    : null;

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Manage</h1>
        <AdminTabs />

        {isSuperAdmin && (
          <section className="manage-section">
            <h2>Schools</h2>
            <form className="school-form" onSubmit={createSchool}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="School name" />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. RAMPUR03)" autoCapitalize="characters" />
              <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="District (optional)" />
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State (optional)" />
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Adding…' : 'Add school'}
              </button>
            </form>

            <div className="table-controls">
              <div className="library-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={schools.search}
                  onChange={(e) => schools.setSearch(e.target.value)}
                  placeholder="Search name, code, or district"
                  aria-label="Search schools"
                />
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>Code</th><th>District</th><th>Teachers</th></tr>
                </thead>
                <tbody>
                  {schools.loading && (
                    <tr><td colSpan={4} className="table-empty">Loading…</td></tr>
                  )}
                  {!schools.loading && schools.error && (
                    <tr><td colSpan={4} className="table-empty">{schools.error}</td></tr>
                  )}
                  {!schools.loading && !schools.error && schools.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="table-empty">
                        {schools.isFiltering ? 'No schools match your search.' : 'No schools yet.'}
                      </td>
                    </tr>
                  )}
                  {!schools.loading && !schools.error && schools.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td><code>{s.code}</code></td>
                      <td>{s.district || '—'}</td>
                      <td>{s.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <TablePager
              noun={{ one: 'school', many: 'schools' }}
              page={schools.page}
              totalPages={schools.totalPages}
              total={schools.total}
              rangeStart={schools.rangeStart}
              rangeEnd={schools.rangeEnd}
              hasPrev={schools.hasPrev}
              hasNext={schools.hasNext}
              onPageChange={schools.setPage}
              busy={schools.loading}
            />
          </section>
        )}

        {/* Approval queue for new sign-ups. Shown to every admin role, but
            the Approve/Reject buttons only appear for the two roles the
            server actually lets act. */}
        <section className="manage-section">
          <h2>Pending teachers</h2>

          <div className="table-controls">
            <div className="library-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={pending.search}
                onChange={(e) => pending.setSearch(e.target.value)}
                placeholder="Search name or email"
                aria-label="Search pending teachers"
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>School</th><th>Requested</th>
                  {canDecide && <th>Decision</th>}
                </tr>
              </thead>
              <tbody>
                {pending.loading && (
                  <tr><td colSpan={canDecide ? 5 : 4} className="table-empty">Loading…</td></tr>
                )}
                {!pending.loading && pending.error && (
                  <tr><td colSpan={canDecide ? 5 : 4} className="table-empty">{pending.error}</td></tr>
                )}
                {!pending.loading && !pending.error && pending.items.length === 0 && (
                  <tr>
                    <td colSpan={canDecide ? 5 : 4} className="table-empty">
                      {pending.isFiltering
                        ? 'No pending sign-ups match your search.'
                        : 'No sign-ups waiting for approval.'}
                    </td>
                  </tr>
                )}
                {!pending.loading && !pending.error && pending.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.school || '—'}{u.schoolCode ? ` (${u.schoolCode})` : ''}</td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    {canDecide && (
                      <td>
                        <button className="btn-primary" onClick={() => decide(u, 'approve')}>Approve</button>{' '}
                        <button className="btn-text" onClick={() => decide(u, 'reject')}>Reject</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            noun={{ one: 'pending sign-up', many: 'pending sign-ups' }}
            page={pending.page}
            totalPages={pending.totalPages}
            total={pending.total}
            rangeStart={pending.rangeStart}
            rangeEnd={pending.rangeEnd}
            hasPrev={pending.hasPrev}
            hasNext={pending.hasNext}
            onPageChange={pending.setPage}
            busy={pending.loading}
          />
        </section>

        <section className="manage-section">
          <h2>Users</h2>

          <div className="table-controls">
            <div className="library-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={users.search}
                onChange={(e) => users.setSearch(e.target.value)}
                placeholder="Search name or email"
                aria-label="Search users"
              />
            </div>
            <div className="table-filters">
              <label className="table-filter">
                <span>Role</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as Role | '')}
                  aria-label="Filter users by role"
                >
                  <option value="">All roles</option>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as UserStatus | '')}
                  aria-label="Filter users by status"
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>School</th><th>Role</th><th>Status</th><th>Last login</th></tr>
              </thead>
              <tbody>
                {users.loading && (
                  <tr><td colSpan={6} className="table-empty">Loading…</td></tr>
                )}
                {!users.loading && users.error && (
                  <tr><td colSpan={6} className="table-empty">{users.error}</td></tr>
                )}
                {!users.loading && !users.error && users.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      {users.isFiltering ? 'No users match your search or filters.' : 'No users yet.'}
                    </td>
                  </tr>
                )}
                {!users.loading && !users.error && users.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    {/* Email is shown because `name` is no longer unique
                        within a school — two teachers can share one. */}
                    <td>{u.email}</td>
                    <td>{u.school || '—'}{u.schoolCode ? ` (${u.schoolCode})` : ''}</td>
                    <td>
                      {isSuperAdmin ? (
                        <select
                          value={u.role}
                          onChange={(e) => requestRoleChange(u, e.target.value as Role)}
                          aria-label={`Role for ${u.name}`}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : (
                        ROLE_LABELS[u.role]
                      )}
                    </td>
                    <td>
                      <span className={`status-pill status-${u.status}`}>{STATUS_LABELS[u.status]}</span>
                    </td>
                    <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            noun={{ one: 'user', many: 'users' }}
            page={users.page}
            totalPages={users.totalPages}
            total={users.total}
            rangeStart={users.rangeStart}
            rangeEnd={users.rangeEnd}
            hasPrev={users.hasPrev}
            hasNext={users.hasNext}
            onPageChange={users.setPage}
            busy={users.loading}
          />
        </section>
      </main>

      {roleConfirm && (
        <ConfirmDialog
          open
          title={roleConfirm.title}
          body={roleConfirm.body}
          confirmLabel={roleConfirm.confirmLabel}
          tone={roleConfirm.tone}
          busy={applyingRole}
          onConfirm={confirmRoleChange}
          onCancel={() => setPendingRole(null)}
        />
      )}
    </div>
  );
}
