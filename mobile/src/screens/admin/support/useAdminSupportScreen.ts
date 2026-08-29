// Logic for AdminSupportScreen — KPI strip, school-filter options, and the
// paginated/searchable/filterable ticket list. Native port of
// AdminSupportPage.tsx's state.
import { useCallback, useEffect, useState } from 'react';
import { listSupportTickets, getSupportTicketStats } from '../../../api/adminSupport';
import { listAdminSchools } from '../../../api/admin';
import { usePagedList } from '../../../lib/usePagedList';
import type { AdminSchool, SupportTicketStats, SupportTicketStatus, SupportTicketSummary, SupportTicketType } from '../../../types';

export function useAdminSupportScreen() {
  const [stats, setStats] = useState<SupportTicketStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSupportTicketStats().then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Populates the School filter dropdown. A one-off fetch at a generous page
  // size, not a searchable picker — fine while school counts stay small, the
  // same honest caveat as AdminSupportPage.tsx's own fetch.
  const [schools, setSchools] = useState<AdminSchool[]>([]);
  useEffect(() => {
    let cancelled = false;
    listAdminSchools({ limit: 100 }).then((res) => { if (!cancelled) setSchools(res.items); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<SupportTicketType | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  // Category has no single cross-type vocabulary (bug and feedback each have
  // their own — config.ts's BUG_CATEGORIES/FEEDBACK_CATEGORIES) — changing
  // Type clears whatever category was selected for the other one.
  function handleTypeChange(value: SupportTicketType | '') {
    setTypeFilter(value);
    setCategoryFilter('');
  }

  const fetchTickets = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listSupportTickets({
        page, limit, q,
        status: statusFilter, type: typeFilter, category: categoryFilter,
        schoolId: schoolFilter, from: fromFilter, to: toFilter,
      }),
    [statusFilter, typeFilter, categoryFilter, schoolFilter, fromFilter, toFilter]
  );
  const tickets = usePagedList<SupportTicketSummary>(
    fetchTickets,
    `${statusFilter}|${typeFilter}|${categoryFilter}|${schoolFilter}|${fromFilter}|${toFilter}`
  );

  return {
    stats, schools, tickets,
    statusFilter, setStatusFilter,
    typeFilter, handleTypeChange,
    categoryFilter, setCategoryFilter,
    schoolFilter, setSchoolFilter,
    fromFilter, setFromFilter,
    toFilter, setToFilter,
  };
}
