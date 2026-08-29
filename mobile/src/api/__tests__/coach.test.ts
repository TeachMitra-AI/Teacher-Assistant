// Request-shaping coverage for api/coach.ts (docs/mobile-app-plan.md §4.2:
// POST /api/coach, POST /api/feedback, and the history-sidebar routes GET/
// DELETE/PATCH /api/queries), same pattern as classroomApi.test.ts — the
// underlying api() request/refresh/auth machinery is already covered by
// client.test.ts (Phase 1); this only asserts the path/method/body shape.
import { askCoach, sendCoachFeedback, listHistory, deleteHistoryItem, clearHistory, updateHistoryItem } from '../coach';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('askCoach', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('POSTs query/language/context to /coach', async () => {
    api.mockResolvedValueOnce({
      success: true,
      text: 'Try starting with a real-world example.',
      language: 'en',
      context: { grade: '', subject: '' },
      queryId: 'q1',
    });

    const context = { grade: 'Grade 6', subject: 'Science', classroomType: '', issueType: '' };
    const result = await askCoach('How do I explain photosynthesis?', 'en', context);

    expect(api).toHaveBeenCalledWith('/coach', {
      method: 'POST',
      body: { query: 'How do I explain photosynthesis?', language: 'en', context },
    });
    expect(result.text).toBe('Try starting with a real-world example.');
  });

  it('propagates a rejection from the underlying api() call', async () => {
    const error = new Error('Network error. Please check your connection.');
    api.mockRejectedValueOnce(error);
    await expect(askCoach('question', 'en', {})).rejects.toBe(error);
  });
});

describe('sendCoachFeedback', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('PATCHes the queryId/rating pair to /feedback', async () => {
    api.mockResolvedValueOnce({ success: true });
    await sendCoachFeedback('q1', 'helpful');
    expect(api).toHaveBeenCalledWith('/feedback', { method: 'POST', body: { queryId: 'q1', rating: 'helpful' } });
  });
});

describe('listHistory', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('GETs /queries with the given limit and unwraps the queries array', async () => {
    const queries = [{ id: 'q1', query: 'A question', language: 'en', context: {}, text: 'An answer', responseTime: 500, createdAt: '2026-08-28T00:00:00.000Z', rating: null, title: null, pinned: false }];
    api.mockResolvedValueOnce({ queries });
    const result = await listHistory(20);
    expect(api).toHaveBeenCalledWith('/queries?limit=20');
    expect(result).toBe(queries);
  });

  it('defaults to a limit of 20', async () => {
    api.mockResolvedValueOnce({ queries: [] });
    await listHistory();
    expect(api).toHaveBeenCalledWith('/queries?limit=20');
  });
});

describe('deleteHistoryItem', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('DELETEs /queries/:id', async () => {
    api.mockResolvedValueOnce({ success: true });
    await deleteHistoryItem('q1');
    expect(api).toHaveBeenCalledWith('/queries/q1', { method: 'DELETE' });
  });
});

describe('clearHistory', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('DELETEs /queries with no id (clear all)', async () => {
    api.mockResolvedValueOnce({ success: true });
    await clearHistory();
    expect(api).toHaveBeenCalledWith('/queries', { method: 'DELETE' });
  });
});

describe('updateHistoryItem', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('PATCHes only the given fields to /queries/:id', async () => {
    api.mockResolvedValueOnce({ success: true, id: 'q1', title: 'New title', pinned: false });
    await updateHistoryItem('q1', { title: 'New title' });
    expect(api).toHaveBeenCalledWith('/queries/q1', { method: 'PATCH', body: { title: 'New title' } });
  });

  it('supports patching pinned', async () => {
    api.mockResolvedValueOnce({ success: true, id: 'q1', title: null, pinned: true });
    await updateHistoryItem('q1', { pinned: true });
    expect(api).toHaveBeenCalledWith('/queries/q1', { method: 'PATCH', body: { pinned: true } });
  });
});
