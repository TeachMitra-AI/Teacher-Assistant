// Logic for AdminSettingsScreen — native port of AdminSettingsPage.tsx's
// state (fetch the registry, toggle a boolean flag, toggle a role in/out of
// a role-list access control).
import { useEffect, useState } from 'react';
import { listFeatureFlags, setBooleanSetting, setRoleListSetting } from '../../../api/adminFeatureFlags';
import { ApiError } from '../../../api/client';
import type { AdminFeatureFlag, Role } from '../../../types';

export function useAdminSettingsScreen() {
  const [flags, setFlags] = useState<AdminFeatureFlag[] | null>(null);
  const [error, setError] = useState('');
  // Tracks the single setting currently being saved so its own control(s)
  // can disable themselves without freezing the rest of the screen.
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFeatureFlags()
      .then((res) => { if (!cancelled) setFlags(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load settings'); });
    return () => { cancelled = true; };
  }, []);

  async function toggleBoolean(flag: AdminFeatureFlag) {
    const nextEnabled = !flag.enabled;
    setPendingId(flag.id);
    try {
      const updated = await setBooleanSetting(flag.id, nextEnabled);
      setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? prev);
    } catch {
      // The switch simply reverts (still reads flag.enabled) — the row's own
      // error isn't tracked per-flag here, matching the toast-per-action
      // shape web uses; a retry is one tap away.
    } finally {
      setPendingId(null);
    }
  }

  async function toggleRole(flag: AdminFeatureFlag, role: Role) {
    const current = flag.roles ?? [];
    const nextRoles = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setPendingId(flag.id);
    try {
      const updated = await setRoleListSetting(flag.id, nextRoles);
      setFlags((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)) ?? prev);
    } catch {
      // Same as toggleBoolean above.
    } finally {
      setPendingId(null);
    }
  }

  const featureFlags = flags?.filter((f) => f.kind === 'feature_flag') ?? [];
  const accessControls = flags?.filter((f) => f.kind === 'access_control') ?? [];

  return { flags, error, pendingId, featureFlags, accessControls, toggleBoolean, toggleRole };
}
