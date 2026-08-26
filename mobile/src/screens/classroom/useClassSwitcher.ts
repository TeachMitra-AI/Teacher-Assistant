// Owns the Class Home header's class-switcher state/API orchestration
// (Phase 8 Step 4, §12: "a compact class-switcher in the Class Home header
// ... so a teacher covering multiple sections doesn't have to back all the
// way out to the Class List between each one"). Deliberately lazy — unlike
// useClassListScreen/useClassHomeScreen's fetch-on-mount, this only fetches
// when the caller invokes `load()` (i.e. when the sheet is actually opened),
// so Class Home's own mount doesn't pay for a request most visits never use.
// Lists ACTIVE classes only — switching "into" an archived class isn't a
// meaningful action (Class List is the surface for reviewing/restoring
// those), matching listClasses' own default.
import { useCallback, useState } from 'react';
import { listClasses } from '../../api/classroomApi';
import { ApiError } from '../../api/client';
import type { SchoolClass } from '../../types';

interface ClassSwitcherState {
  classes: SchoolClass[];
  loading: boolean;
  error: string;
  load: () => void;
}

export function useClassSwitcher(): ClassSwitcherState {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listClasses();
      setClasses(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { classes, loading, error, load };
}
