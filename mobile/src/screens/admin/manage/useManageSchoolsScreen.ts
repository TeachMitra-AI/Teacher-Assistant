// Logic for ManageSchoolsScreen — new-school form + the paginated/searchable
// schools list. Native port of ManagePage.tsx's Schools section state.
import { useCallback, useState } from 'react';
import { listAdminSchools, createSchool as createSchoolApi } from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { usePagedList } from '../../../lib/usePagedList';
import type { AdminSchool } from '../../../types';

export function useManageSchoolsScreen() {
  const fetchSchools = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) => listAdminSchools({ page, limit, q }),
    []
  );
  const schools = usePagedList<AdminSchool>(fetchSchools, '');

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState(false);

  async function createSchool() {
    if (!name.trim() || code.trim().length < 3) {
      setCreateError('Enter a name and a code of at least 3 characters');
      return;
    }
    setCreateError('');
    setCreated(false);
    setCreating(true);
    try {
      await createSchoolApi({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        district: district.trim() || undefined,
        state: state.trim() || undefined,
      });
      setName('');
      setCode('');
      setDistrict('');
      setState('');
      setCreated(true);
      // Refetch rather than unshifting the new row: with server-side paging
      // the new school belongs wherever the sort and the current search put
      // it, and `total` has to move with it.
      await schools.refetch();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Could not create school');
    } finally {
      setCreating(false);
    }
  }

  return {
    schools,
    name, setName,
    code, setCode,
    district, setDistrict,
    state, setState,
    creating, createError, created,
    createSchool,
  };
}
