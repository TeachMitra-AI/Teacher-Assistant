// Request-shaping coverage for api/coach.ts (docs/mobile-app-plan.md §4.2:
// POST /api/coach, POST /api/feedback), same pattern as classroomApi.test.ts
// — the underlying api() request/refresh/auth machinery is already covered
// by client.test.ts (Phase 1); this only asserts the path/method/body shape.
import { askCoach, sendCoachFeedback } from '../coach';

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
