import { listFeatureFlags, setBooleanSetting, setRoleListSetting } from '../adminFeatureFlags';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('adminFeatureFlags api', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('listFeatureFlags unwraps the flags array', async () => {
    const flags = [{ id: 'learning-representation', label: 'Learning Representation', kind: 'feature_flag', type: 'boolean', enabled: true, source: 'env-default', updatedAt: null }];
    api.mockResolvedValueOnce({ flags });
    const result = await listFeatureFlags();
    expect(api).toHaveBeenCalledWith('/admin/feature-flags');
    expect(result).toBe(flags);
  });

  it('setBooleanSetting PATCHes the enabled flag', async () => {
    const updated = { id: 'learning-representation', enabled: false };
    api.mockResolvedValueOnce(updated);
    const result = await setBooleanSetting('learning-representation', false);
    expect(api).toHaveBeenCalledWith('/admin/feature-flags/learning-representation', { method: 'PATCH', body: { enabled: false } });
    expect(result).toBe(updated);
  });

  it('setRoleListSetting PATCHes the roles list', async () => {
    const updated = { id: 'assistant-allowed-roles', roles: ['teacher'] };
    api.mockResolvedValueOnce(updated);
    const result = await setRoleListSetting('assistant-allowed-roles', ['teacher']);
    expect(api).toHaveBeenCalledWith('/admin/feature-flags/assistant-allowed-roles', { method: 'PATCH', body: { roles: ['teacher'] } });
    expect(result).toBe(updated);
  });
});
