import { useEffect, useState, type FormEvent } from 'react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import { ROLE_LABELS } from '../config';
import type { AdminSchool, AdminUser, Role } from '../types';

const ROLES: Role[] = ['teacher', 'school_admin', 'resource_person', 'super_admin'];

export default function ManagePage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user } = useAuth();
  const { show } = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  // Every admin role can SEE the pending queue; only these two may decide on
  // it, matching the server's gate on approve/reject. A resource_person gets
  // read-only visibility.
  const canDecide = user?.role === 'school_admin' || user?.role === 'super_admin';

  const [schools, setSchools] = useState<AdminSchool[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pending, setPending] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // New-school form state.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, pendingRes, schoolsRes] = await Promise.all([
          api<{ users: AdminUser[] }>('/admin/users'),
          api<{ users: AdminUser[] }>('/admin/users/pending'),
          isSuperAdmin ? api<{ schools: AdminSchool[] }>('/admin/schools') : Promise.resolve({ schools: [] }),
        ]);
        if (cancelled) return;
        setUsers(usersRes.users);
        setPending(pendingRes.users);
        setSchools(schoolsRes.schools);
      } catch (err) {
        if (!cancelled) show(err instanceof ApiError ? err.message : 'Failed to load data', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSuperAdmin, show]);

  async function createSchool(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || code.trim().length < 3) {
      show('Enter a name and a code of at least 3 characters', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ school: AdminSchool }>('/admin/schools', {
        method: 'POST',
        body: {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          district: district.trim() || undefined,
          state: state.trim() || undefined,
        },
      });
      setSchools((s) => [{ ...res.school, users: 0, queries: 0 }, ...s]);
      setName(''); setCode(''); setDistrict(''); setState('');
      show('School created', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not create school', 'error');
    } finally {
      setCreating(false);
    }
  }

  // Same optimistic-update-then-roll-back-on-failure shape as changeRole
  // below: the row leaves the queue immediately, and comes back if the server
  // refuses. On approval the teacher also joins the Users table, so that list
  // is kept in step without a refetch.
  async function decide(target: AdminUser, action: 'approve' | 'reject') {
    const previousPending = pending;
    const previousUsers = users;
    setPending((list) => list.filter((u) => u.id !== target.id));
    if (action === 'approve') {
      setUsers((list) => [{ ...target, status: 'active' }, ...list]);
    }
    try {
      await api(`/admin/users/${target.id}/${action}`, { method: 'PATCH' });
      show(action === 'approve' ? `${target.name} approved` : `${target.name} rejected`, 'success');
    } catch (err) {
      setPending(previousPending);
      setUsers(previousUsers);
      show(err instanceof ApiError ? err.message : `Could not ${action} this teacher`, 'error');
    }
  }

  async function changeRole(id: string, role: Role) {
    const previous = users;
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, role } : u)));
    try {
      await api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } });
      show('Role updated', 'success');
    } catch (err) {
      setUsers(previous);
      show(err instanceof ApiError ? err.message : 'Could not update role', 'error');
    }
  }

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Manage</h1>
        <AdminTabs />

        {loading && <div className="response-loading"><div className="spinner" /><p>Loading…</p></div>}

        {!loading && (
          <>
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

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Name</th><th>Code</th><th>District</th><th>Teachers</th><th>Questions</th></tr>
                    </thead>
                    <tbody>
                      {schools.length === 0 && <tr><td colSpan={5} className="table-empty">No schools yet.</td></tr>}
                      {schools.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td><code>{s.code}</code></td>
                          <td>{s.district || '—'}</td>
                          <td>{s.users}</td>
                          <td>{s.queries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Approval queue for new sign-ups. Shown to every admin role, but
                the Approve/Reject buttons only appear for the two roles the
                server actually lets act. */}
            <section className="manage-section">
              <h2>Pending teachers</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Email</th><th>School</th><th>Requested</th>
                      {canDecide && <th>Decision</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pending.length === 0 && (
                      <tr>
                        <td colSpan={canDecide ? 5 : 4} className="table-empty">
                          No sign-ups waiting for approval.
                        </td>
                      </tr>
                    )}
                    {pending.map((u) => (
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
            </section>

            <section className="manage-section">
              <h2>Users</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>School</th><th>Role</th><th>Last login</th></tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && <tr><td colSpan={5} className="table-empty">No users yet.</td></tr>}
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        {/* Email is shown because `name` is no longer unique
                            within a school — two teachers can share one. */}
                        <td>{u.email}</td>
                        <td>{u.school || '—'}{u.schoolCode ? ` (${u.schoolCode})` : ''}</td>
                        <td>
                          {isSuperAdmin ? (
                            <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role)}>
                              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </select>
                          ) : (
                            ROLE_LABELS[u.role]
                          )}
                        </td>
                        <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
