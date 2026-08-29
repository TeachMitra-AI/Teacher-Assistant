import {
  getAnalytics, listAdminUsers, listPendingUsers, listAdminSchools, createSchool, decidePendingUser, changeUserRole,
} from '../admin';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('admin api', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('getAnalytics calls the role-scoped analytics endpoint', async () => {
    const payload = {
      totals: { queries: 1, teachers: 1, activeTeachers: 1, feedback: 0, helpfulRatio: 0 },
      bySubject: [],
      byIssueType: [],
      byLanguage: [],
      byDay: [],
      topQuestions: [],
    };
    api.mockResolvedValueOnce(payload);
    const result = await getAnalytics();
    expect(api).toHaveBeenCalledWith('/admin/analytics');
    expect(result).toBe(payload);
  });

  it('listAdminUsers builds a query string, omitting empty filters and page=1', async () => {
    api.mockResolvedValueOnce({ users: [], total: 0, page: 1, limit: 25 });
    await listAdminUsers({ page: 1, q: 'jane', role: 'teacher', status: '' });
    expect(api).toHaveBeenCalledWith('/admin/users?q=jane&role=teacher');
  });

  it('listAdminUsers falls back to items.length when the server omits total/page/limit', async () => {
    api.mockResolvedValueOnce({ users: [{ id: '1' }] });
    const result = await listAdminUsers({ page: 2 });
    expect(api).toHaveBeenCalledWith('/admin/users?page=2');
    expect(result).toEqual({ items: [{ id: '1' }], total: 1, page: 2, limit: 1 });
  });

  it('listPendingUsers calls the pending endpoint', async () => {
    api.mockResolvedValueOnce({ users: [], total: 0, page: 1, limit: 25 });
    await listPendingUsers({ q: 'sam' });
    expect(api).toHaveBeenCalledWith('/admin/users/pending?q=sam');
  });

  it('listAdminSchools calls the schools endpoint', async () => {
    api.mockResolvedValueOnce({ schools: [], total: 0, page: 1, limit: 25 });
    await listAdminSchools({ q: 'rampur' });
    expect(api).toHaveBeenCalledWith('/admin/schools?q=rampur');
  });

  it('createSchool posts the form and returns the created school', async () => {
    const school = { id: 's1', name: 'Rampur High', code: 'RAMPUR03', users: 0 };
    api.mockResolvedValueOnce({ school });
    const result = await createSchool({ name: 'Rampur High', code: 'RAMPUR03' });
    expect(api).toHaveBeenCalledWith('/admin/schools', { method: 'POST', body: { name: 'Rampur High', code: 'RAMPUR03' } });
    expect(result).toBe(school);
  });

  it('decidePendingUser PATCHes the approve/reject action', async () => {
    api.mockResolvedValueOnce(undefined);
    await decidePendingUser('u1', 'approve');
    expect(api).toHaveBeenCalledWith('/admin/users/u1/approve', { method: 'PATCH' });
  });

  it('changeUserRole PATCHes the new role', async () => {
    api.mockResolvedValueOnce(undefined);
    await changeUserRole('u1', 'school_admin');
    expect(api).toHaveBeenCalledWith('/admin/users/u1/role', { method: 'PATCH', body: { role: 'school_admin' } });
  });
});
