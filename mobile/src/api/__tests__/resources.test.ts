// Light coverage of resources.ts's query-string building — the rest of the
// file is a direct, mechanical port of the already-tested web client.
import { listResources, generateAssessmentSet } from '../resources';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('resources', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('listResources omits the query string when no params are given', async () => {
    api.mockResolvedValueOnce({ resources: [] });
    await listResources();
    expect(api).toHaveBeenCalledWith('/resources');
  });

  it('listResources combines type/q/sourceQueryId into one query string', async () => {
    api.mockResolvedValueOnce({ resources: [] });
    await listResources({ type: 'quiz' as never, q: 'fractions', sourceQueryId: 'q1' });
    const [path] = api.mock.calls[0];
    expect(path).toBe('/resources?type=quiz&q=fractions&sourceQueryId=q1');
  });

  it('generateAssessmentSet POSTs the full item batch in one call', async () => {
    api.mockResolvedValueOnce({ results: [], requestId: 'r1' });
    const input = {
      topic: 'Fractions',
      items: [{ format: 'quiz' as const, difficulty: 'easy' as const, questionType: 'mcq' as const, questionCount: 5 }],
    };
    await generateAssessmentSet(input);
    expect(api).toHaveBeenCalledWith('/resources/generate-set', { method: 'POST', body: input });
  });
});
