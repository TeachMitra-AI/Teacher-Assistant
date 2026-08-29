import { roleChangeConfirmation } from '../roleChange';

describe('roleChangeConfirmation', () => {
  it('warns with danger tone when granting super_admin', () => {
    const result = roleChangeConfirmation('teacher', 'super_admin', 'Asha Verma');
    expect(result.tone).toBe('danger');
    expect(result.title).toBe('Grant Super Admin access?');
    expect(result.body).toContain('Asha Verma');
  });

  it('warns with danger tone when removing super_admin', () => {
    const result = roleChangeConfirmation('super_admin', 'school_admin', 'Asha Verma');
    expect(result.tone).toBe('danger');
    expect(result.title).toBe('Remove Super Admin access?');
    expect(result.body).toContain('School Admin');
  });

  it('uses default tone for an ordinary role change', () => {
    const result = roleChangeConfirmation('teacher', 'resource_person', 'Asha Verma');
    expect(result.tone).toBe('default');
    expect(result.body).toBe('Asha Verma will change from Teacher to Resource Person.');
  });
});
