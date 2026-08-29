// Logic for ManagePendingScreen — the new-sign-up approval queue. Native
// port of ManagePage.tsx's Pending teachers section state.
import { useCallback, useState } from 'react';
import { listPendingUsers, decidePendingUser } from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { usePagedList } from '../../../lib/usePagedList';
import type { AdminUser } from '../../../types';

export function useManagePendingScreen() {
  const fetchPending = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) => listPendingUsers({ page, limit, q }),
    []
  );
  const pending = usePagedList<AdminUser>(fetchPending, '');

  // Tracks which row's Approve/Reject is in flight so only that row disables.
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState('');

  async function decide(target: AdminUser, action: 'approve' | 'reject') {
    setDecideError('');
    pending.patchItem(
      (u) => u.id === target.id,
      (u) => ({ ...u, status: action === 'approve' ? 'active' : 'rejected' })
    );
    setDecidingId(target.id);
    try {
      await decidePendingUser(target.id, action);
    } catch (err) {
      setDecideError(err instanceof ApiError ? err.message : `Could not ${action} this teacher`);
    } finally {
      setDecidingId(null);
      // Runs on success and failure: on failure this is what restores the
      // row to its true server-side state.
      await pending.refetch();
    }
  }

  return { pending, decidingId, decideError, decide };
}
