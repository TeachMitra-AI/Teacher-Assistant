// Copy for the "are you sure?" step in front of a role change — native port
// of client/src/lib/roleChange.ts, same pure function so the wording of each
// transition is testable without rendering a screen. Every role change is
// confirmed, not just escalation to super_admin: demoting the wrong colleague
// locks them out of work they were doing, which is as disruptive as an
// accidental grant. `tone: 'danger'` is reserved for transitions that move
// full administrative access — ManageUsersScreen.tsx renders the confirming
// Alert.alert's destructive button style off this.
import { ROLE_LABELS } from '../config';
import type { Role } from '../types';

export interface RoleChangeConfirmation {
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'danger' | 'default';
}

export function roleChangeConfirmation(from: Role, to: Role, name: string): RoleChangeConfirmation {
  if (to === 'super_admin') {
    return {
      title: 'Grant Super Admin access?',
      body: `This gives ${name} full administrative access, including the ability to change other users' roles.`,
      confirmLabel: 'Grant access',
      tone: 'danger',
    };
  }
  if (from === 'super_admin') {
    return {
      title: 'Remove Super Admin access?',
      body: `${name} will lose full administrative access and become a ${ROLE_LABELS[to]}.`,
      confirmLabel: 'Remove access',
      tone: 'danger',
    };
  }
  return {
    title: 'Change role?',
    body: `${name} will change from ${ROLE_LABELS[from]} to ${ROLE_LABELS[to]}.`,
    confirmLabel: 'Change role',
    tone: 'default',
  };
}
