// TEMPORARY stand-in for real auth (docs/mobile-app-plan.md §26 Phase 2's
// acceptance criterion: "role-gating stub — Admin hidden for a mocked
// teacher role"). Phase 3 replaces this entirely with the ported
// client/src/auth.tsx state machine and a real `user.role` from the server.
// Exists only so the navigation tree's role-gating logic (§10: Admin stays
// inside More, role-gated the same way App.tsx:59,82 gates it on web) has
// something real to gate against and can be exercised on-device before
// Phase 3's login flow exists. `setRole` is exposed so Phase 2's own device
// verification can toggle roles and see Admin appear/disappear — a dev-only
// affordance, not a feature.
import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Role } from '../types';

const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

interface MockRoleContextValue {
  role: Role;
  isAdmin: boolean;
  setRole: (role: Role) => void;
}

const MockRoleContext = createContext<MockRoleContextValue | null>(null);

export function MockRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>('teacher');
  const value = useMemo(() => ({ role, isAdmin: ADMIN_ROLES.includes(role), setRole }), [role]);
  return <MockRoleContext.Provider value={value}>{children}</MockRoleContext.Provider>;
}

export function useMockRole(): MockRoleContextValue {
  const ctx = useContext(MockRoleContext);
  if (!ctx) throw new Error('useMockRole must be used within a MockRoleProvider');
  return ctx;
}
