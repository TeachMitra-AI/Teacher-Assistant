// Request-shaping coverage for api/support.ts (POST /support/tickets), same
// pattern as coach.test.ts — the underlying api() request/refresh/auth
// machinery is already covered by client.test.ts (Phase 1).
import { createSupportTicket, captureAutoContext } from '../support';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('createSupportTicket', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('POSTs the ticket input to /support/tickets and unwraps id/status', async () => {
    api.mockResolvedValueOnce({ success: true, id: 't1', status: 'open' });

    const input = {
      type: 'bug' as const,
      category: 'crash',
      description: 'The app closed unexpectedly.',
      context: { buildId: 'mobile', theme: 'dark' as const, language: 'en' },
    };
    const result = await createSupportTicket(input);

    expect(api).toHaveBeenCalledWith('/support/tickets', { method: 'POST', body: input });
    expect(result).toEqual({ id: 't1', status: 'open' });
  });

  it('propagates a rejection from the underlying api() call', async () => {
    const error = new Error('Network error. Please check your connection.');
    api.mockRejectedValueOnce(error);
    await expect(createSupportTicket({ type: 'feedback', category: 'other' })).rejects.toBe(error);
  });
});

describe('captureAutoContext', () => {
  it('builds the auto-captured context with buildId/theme/language', () => {
    expect(captureAutoContext('dark', 'hi')).toEqual({
      buildId: 'mobile',
      theme: 'dark',
      language: 'hi',
    });
  });

  it('folds in extra fields without dropping the base ones', () => {
    expect(captureAutoContext('light', 'en', { grade: 'Class 5' })).toEqual({
      buildId: 'mobile',
      theme: 'light',
      language: 'en',
      grade: 'Class 5',
    });
  });

  it('language is optional', () => {
    expect(captureAutoContext('light')).toEqual({ buildId: 'mobile', theme: 'light', language: undefined });
  });
});
