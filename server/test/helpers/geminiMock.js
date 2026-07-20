// Shared test helper: stubs the global `fetch` that GeminiService (server/src/gemini.js)
// calls directly, so tests can drive the real GeminiService/route code
// end-to-end without making a real network call. No changes to gemini.js
// are needed for this to work.
//
// `vi` is not require()'d here — Vitest's CJS entry point refuses to be
// require()'d directly. Instead this relies on `vi` being available as a
// real global, which vitest.config.js's `test.globals: true` provides for
// every test file (and, transitively, plain CJS helpers they require()).

/**
 * @param {Array<{status?: number, json?: object, text?: string, reject?: Error}>} responseQueue
 *   One entry consumed per fetch call, in order. If there are more calls
 *   than entries, the LAST entry repeats for every subsequent call — handy
 *   for "always fails" or "always succeeds" scenarios without listing every
 *   call explicitly.
 * @returns {{ mock: import('vitest').Mock, calls: Array<{url: string, body: any, headers: any}> }}
 */
function mockGeminiFetch(responseQueue) {
  const calls = [];
  const mock = vi.fn(async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body, headers: opts && opts.headers });
    const index = Math.min(calls.length - 1, responseQueue.length - 1);
    const spec = responseQueue[index];
    if (spec.reject) {
      throw spec.reject;
    }
    return toFetchResponse(spec);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

function toFetchResponse({ status = 200, json, text }) {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => json,
    text: async () => (text !== undefined ? text : JSON.stringify(json ?? {})),
  };
}

/** Builds a realistic successful Gemini generateContent response body. */
function geminiSuccess(text, finishReason = 'STOP') {
  return {
    status: 200,
    json: {
      candidates: [{ content: { parts: [{ text }] }, finishReason }],
    },
  };
}

/** Builds a response where the INPUT was blocked before generation started. */
function geminiInputBlocked(blockReason = 'SAFETY') {
  return {
    status: 200,
    json: { candidates: [], promptFeedback: { blockReason } },
  };
}

/** Builds a response where the OUTPUT was blocked (e.g. by safety filters). */
function geminiOutputBlocked(finishReason = 'SAFETY') {
  return {
    status: 200,
    json: { candidates: [{ content: { parts: [] }, finishReason }] },
  };
}

module.exports = { mockGeminiFetch, toFetchResponse, geminiSuccess, geminiInputBlocked, geminiOutputBlocked };
