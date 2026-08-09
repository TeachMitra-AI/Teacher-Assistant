import { describe, expect, test } from 'vitest';
import { roleChangeConfirmation } from './roleChange';

describe('roleChangeConfirmation', () => {
  test('granting super_admin is a danger-toned confirmation', () => {
    const c = roleChangeConfirmation('teacher', 'super_admin', 'Asha');
    expect(c.tone).toBe('danger');
    expect(c.title).toBe('Grant Super Admin access?');
    expect(c.body).toContain('Asha');
    expect(c.body).toContain('full administrative access');
  });

  // The reported issue asked about the grant; the reverse strands a colleague
  // out of work they were doing, so it is confirmed just as loudly.
  test('removing super_admin is also danger-toned and names the new role', () => {
    const c = roleChangeConfirmation('super_admin', 'teacher', 'Ravi');
    expect(c.tone).toBe('danger');
    expect(c.title).toBe('Remove Super Admin access?');
    expect(c.body).toContain('Ravi');
    expect(c.body).toContain('Teacher');
  });

  test('an ordinary change is still confirmed, in the default tone', () => {
    const c = roleChangeConfirmation('teacher', 'school_admin', 'Meera');
    expect(c.tone).toBe('default');
    expect(c.title).toBe('Change role?');
    expect(c.body).toContain('Teacher');
    expect(c.body).toContain('School Admin');
  });

  test('every transition produces a non-empty label and body', () => {
    const roles = ['teacher', 'school_admin', 'resource_person', 'super_admin'] as const;
    for (const from of roles) {
      for (const to of roles) {
        if (from === to) continue;
        const c = roleChangeConfirmation(from, to, 'Sam');
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.body.length).toBeGreaterThan(0);
        expect(c.confirmLabel.length).toBeGreaterThan(0);
      }
    }
  });
});
