// "Stop generating" (CoachPage's Composer): the /api/coach route wires the client's abort into GeminiService via an
// AbortSignal, so a cancelled request neither retries nor keeps calling Gemini after the teacher walks away.
const { GeminiService } = require('../src/gemini');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

function makeService(overrides = {}) {
  return new GeminiService({
    apiKey: 'test-fake-key',
    endpoint: 'https://example.invalid/generate',
    timeoutMs: 5000,
    maxRetries: 3,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

const ask = (service, signal) =>
  service.generateResponse({ query: 'A question', context: {}, language: 'en' }, { signal });

describe('GeminiService cancellation (teacher-initiated "Stop generating")', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a signal already aborted before the call rejects with CLIENT_ABORTED and never calls fetch', async () => {
    const { mock } = mockGeminiFetch([geminiSuccess('Should never be read.')]);
    const service = makeService();
    const controller = new AbortController();
    controller.abort();

    await expect(ask(service, controller.signal)).rejects.toMatchObject({ code: 'CLIENT_ABORTED' });
    expect(mock).not.toHaveBeenCalled();
  });

  test('aborting mid-flight cancels the in-flight fetch and rejects with CLIENT_ABORTED, no retry', async () => {
    // A fetch stand-in that honors AbortSignal like the real one: it never resolves on its own, only rejects
    // once the signal passed to it fires — exactly what GeminiService hands every fetch call.
    const calls = [];
    const fetchImpl = vi.fn((url, opts) => {
      calls.push(opts);
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const service = makeService({ fetchImpl });
    const controller = new AbortController();

    const promise = ask(service, controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'CLIENT_ABORTED' });
    // One fetch attempt, never retried — a deliberate cancellation isn't a transient failure.
    expect(calls).toHaveLength(1);
  });

  test('a response that already completed before the signal aborts is unaffected (no race once settled)', async () => {
    const { mock } = mockGeminiFetch([geminiSuccess('The real answer.')]);
    const service = makeService();
    const controller = new AbortController();

    const result = await ask(service, controller.signal);
    controller.abort(); // too late to matter — matches the client-side race (see api.ts)

    expect(result.text).toBe('The real answer.');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
