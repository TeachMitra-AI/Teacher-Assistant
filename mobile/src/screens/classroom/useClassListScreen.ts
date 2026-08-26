// Owns Class List's state/API orchestration, separate from the screen's JSX
// (docs/mobile-app-plan.md Phase 7c's "Screen -> useXScreen() -> state/API/
// business rules -> UI" convention). Phase 8 Step 1 scope: real classes via
// classroomApi.listClasses. Phase 8 Step 4 scope: create/archive/restore,
// reusing the already-ported classroomApi.{createClass,updateClass,archiveClass}
// — no new API layer. Archived-visibility follows the same pattern as the
// web's StudentRoster.tsx "Show inactive" toggle and this mobile app's own
// useStudentsScreen.ts precedent: always fetch WITH archived classes
// included, then filter client-side, so flipping the toggle never needs a
// round trip.
import { useCallback, useEffect, useState } from 'react';
import { listClasses, createClass, updateClass, archiveClass } from '../../api/classroomApi';
import type { CreateClassInput } from '../../api/classroomApi';
import { ApiError } from '../../api/client';
import type { SchoolClass } from '../../types';

interface ClassListScreenState {
  classes: SchoolClass[];
  loading: boolean;
  error: string;
  reload: () => void;
  showArchived: boolean;
  toggleShowArchived: () => void;
  creating: boolean;
  createError: string;
  createClass: (input: CreateClassInput) => Promise<boolean>;
  archivingId: string | null;
  archiveError: string;
  // Archives an active class, or restores an archived one — symmetric with
  // classroomApi.archiveClass/updateClass(id, {archived:false}) below.
  toggleArchive: (cls: SchoolClass) => Promise<boolean>;
}

export function useClassListScreen(): ClassListScreenState {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listClasses(true);
      setClasses(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern — see useClassHomeScreen.ts's
    // identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const createClassAction = useCallback(async (input: CreateClassInput) => {
    setCreating(true);
    setCreateError('');
    try {
      const created = await createClass(input);
      setClasses((list) => [...list, created]);
      return true;
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Could not create class.');
      return false;
    } finally {
      setCreating(false);
    }
  }, []);

  const toggleArchive = useCallback(async (cls: SchoolClass) => {
    setArchivingId(cls.id);
    setArchiveError('');
    try {
      const updated = cls.archived ? await updateClass(cls.id, { archived: false }) : await archiveClass(cls.id);
      setClasses((list) => list.map((c) => (c.id === updated.id ? updated : c)));
      return true;
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : 'Could not update the class.');
      return false;
    } finally {
      setArchivingId(null);
    }
  }, []);

  return {
    classes,
    loading,
    error,
    reload: load,
    showArchived,
    toggleShowArchived: () => setShowArchived((v) => !v),
    creating,
    createError,
    createClass: createClassAction,
    archivingId,
    archiveError,
    toggleArchive,
  };
}
