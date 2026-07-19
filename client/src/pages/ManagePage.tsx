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

  const [schools, setSchools] = useState<AdminSchool[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
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
        const [usersRes, schoolsRes] = await Promise.all([
          api<{ users: AdminUser[] }>('/admin/users'),
          isSuperAdmin ? api<{ schools: AdminSchool[] }>('/admin/schools') : Promise.resolve({ schools: [] }),
        ]);
        if (cancelled) return;
        setUsers(usersRes.users);
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

            <section className="manage-section">
              <h2>Users</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Name</th><th>School</th><th>Role</th><th>Last login</th></tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && <tr><td colSpan={4} className="table-empty">No users yet.</td></tr>}
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
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
