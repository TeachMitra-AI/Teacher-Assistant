// Logic for ManageUsersScreen — the searchable/filterable users table plus
// super_admin's role-change control. Native port of ManagePage.tsx's Users
// section state. A role change is never applied straight from the picker:
// picking an option only stages it; confirmRoleChange() is what commits it
// (see ManageUsersScreen.tsx's Alert.alert, this app's established
// destructive-confirm convention — the row is NOT patched optimistically,
// so Cancel is a no-op with nothing to roll back).
import { useCallback, useState } from 'react';
import { listAdminUsers, changeUserRole as changeUserRoleApi } from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { usePagedList } from '../../../lib/usePagedList';
import { roleChangeConfirmation } from '../../../lib/roleChange';
import type { AdminUser, Role, UserStatus } from '../../../types';

export function useManageUsersScreen() {
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');

  const fetchUsers = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listAdminUsers({ page, limit, q, role: roleFilter, status: statusFilter }),
    [roleFilter, statusFilter]
  );
  const users = usePagedList<AdminUser>(fetchUsers, `${roleFilter}|${statusFilter}`);

  const [applyingRoleFor, setApplyingRoleFor] = useState<string | null>(null);
  const [roleError, setRoleError] = useState('');

  // Re-selecting the role a user already has is not a change worth
  // confirming (and the server would reject it as a no-op anyway).
  function stageRoleChange(target: AdminUser, role: Role): ReturnType<typeof roleChangeConfirmation> | null {
    if (role === target.role) return null;
    return roleChangeConfirmation(target.role, role, target.name);
  }

  async function confirmRoleChange(target: AdminUser, role: Role) {
    setRoleError('');
    setApplyingRoleFor(target.id);
    try {
      await changeUserRoleApi(target.id, role);
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : 'Could not update role');
    } finally {
      setApplyingRoleFor(null);
      // Runs either way. A role change can move the row out of the current
      // view when a role filter is active, and on failure this is what
      // proves the picker is still showing the true server-side role.
      await users.refetch();
    }
  }

  return {
    users,
    roleFilter, setRoleFilter,
    statusFilter, setStatusFilter,
    applyingRoleFor, roleError,
    stageRoleChange, confirmRoleChange,
  };
}
