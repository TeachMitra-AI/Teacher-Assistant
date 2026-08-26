import { getAnalytics } from '../admin';

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
});
