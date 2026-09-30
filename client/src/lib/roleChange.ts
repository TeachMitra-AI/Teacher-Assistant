// Copy for the "are you sure?" step before a role change. A pure function so each transition's wording is testable. Every
// change is confirmed, not just escalation to super_admin: demoting the wrong colleague locks them out as disruptively as an
// accidental grant. The `danger` tone is reserved for transitions that move full administrative access.
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
