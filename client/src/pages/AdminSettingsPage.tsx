import { useEffect, useState } from 'react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import { useToast } from '../components/Toast';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import { listFeatureFlags, setBooleanSetting, setRoleListSetting } from '../lib/adminFeatureFlags';
import { ROLE_LABELS } from '../config';
import type { AdminFeatureFlag, Role } from '../types';

// Every role the app has, for rendering the Assistant Access checkboxes —
// reuses config.ts's existing ROLE_LABELS (already the client's canonical
// role vocabulary; see ManagePage.tsx for the same convention) rather than
// declaring a second list here.
const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

// Admin Settings — lets a super_admin temporarily override existing env-var
// configuration at runtime, no redeploy needed. Two sections, driven by the
// same registry-backed list (GET /api/admin/feature-flags): Feature
// Management (boolean flags, e.g. Learning Representation) and AI Access
// (role-list access controls, e.g. who may use the Assistant). Every control
// is additive on top of its existing kill switch / env var — turning
// something off here (or leaving it unconfigured) still leaves the env var
// as the safe baseline.
export default function AdminSettingsPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const [flags, setFlags] = useState<AdminFeatureFlag[] | null>(null);
  const [error, setError] = useState('');
  // Tracks the single setting currently being saved so its own control(s)
  // can disable themselves without freezing the rest of the page.
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFeatureFlags()
      .then((res) => { if (!cancelled) setFlags(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load settings'); });
    return () => { cancelled = true; };
  }, []);

  async function handleBooleanToggle(flag: AdminFeatureFlag) {
    const nextEnabled = !flag.enabled;
    setPendingId(flag.id);
    try {
      const updated = await setBooleanSetting(flag.id, nextEnabled);
      setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? prev);
      show(`${flag.label} ${nextEnabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Could not update ${flag.label}`, 'error');
    } finally {
      setPendingId(null);
    }
  }

  async function handleRoleToggle(flag: AdminFeatureFlag, role: Role) {
    const current = flag.roles ?? [];
    const nextRoles = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setPendingId(flag.id);
    try {
      const updated = await setRoleListSetting(flag.id, nextRoles);
      setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? prev);
      show(`${flag.label} updated`, 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Could not update ${flag.label}`, 'error');
    } finally {
      setPendingId(null);
    }
  }

  const featureFlags = flags?.filter((f) => f.kind === 'feature_flag') ?? [];
  const accessControls = flags?.filter((f) => f.kind === 'access_control') ?? [];

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Admin Settings</h1>
        <AdminTabs />

        {error && <p className="auth-error">{error}</p>}
        {!flags && !error && <div className="response-loading"><div className="spinner" /><p>Loading…</p></div>}

        {flags && (
          <>
            <section className="settings-card">
              <h2>Feature Management</h2>
              <p className="settings-hint">
                Temporarily turn a feature on or off for every teacher, without a deployment. Turning a flag off here
                never removes it from the server config — it's the same underlying kill switch, just reachable from here.
              </p>

              {featureFlags.map((flag) => (
                <div className="settings-row" key={flag.id}>
                  <span>
                    {flag.label}
                    <span className={`feature-flag-state ${flag.enabled ? 'is-on' : 'is-off'}`}>
                      {flag.enabled ? 'ON' : 'OFF'}
                    </span>
                    {flag.source === 'env-default' && (
                      <span className="settings-hint feature-flag-source"> (using server default — no override set)</span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={flag.enabled}
                    disabled={pendingId === flag.id}
                    onChange={() => handleBooleanToggle(flag)}
                    aria-label={`Toggle ${flag.label}`}
                  />
                </div>
              ))}
            </section>

            <section className="settings-card">
              <h2>AI Access</h2>
              <p className="settings-hint">
                Choose which roles may use the AI Assistant. This is enforced on the server for every request — it
                is not just a UI preference. Leaving every role unchecked turns the Assistant off for everyone.
              </p>

              {accessControls.map((flag) => (
                <div key={flag.id}>
                  <p className="settings-hint">
                    {flag.description}
                    {flag.source === 'env-default'
                      ? ' (using server default — no override set)'
                      : ' (admin override active)'}
                  </p>
                  <div className="role-access-grid">
                    {ALL_ROLES.map((role) => (
                      <label className="role-access-option" key={role}>
                        <input
                          type="checkbox"
                          checked={(flag.roles ?? []).includes(role)}
                          disabled={pendingId === flag.id}
                          onChange={() => handleRoleToggle(flag, role)}
                          aria-label={`Allow ${ROLE_LABELS[role]} to use the Assistant`}
                        />
                        <span>{ROLE_LABELS[role]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
