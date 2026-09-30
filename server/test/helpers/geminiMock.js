// Stubs the global `fetch` that GeminiService (server/src/gemini.js) calls, so tests can drive the real
// GeminiService/route code end to end with no network call.
// `vi` isn't require()'d: Vitest's CJS entry refuses to be required. It relies on `vi` being a real global from
// `test.globals: true` in vitest.config.js, which reaches the CJS helpers test files require().

/**
 * @param {Array<{status?: number, json?: object, text?: string, reject?: Error, headers?: object}>} responseQueue
 *   One entry is consumed per fetch call, in order. With more calls than entries the last entry repeats, handy for
 *   "always fails"/"always succeeds". `headers` is a plain object (e.g. { 'retry-after': '2' }); `reject` makes the
 *   fetch itself throw (network error / timeout).
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

// Minimal Headers-like object so gemini.js's `response.headers.get('retry-after')`
// works against the mock (case-insensitive, matching the real Fetch Headers).
function makeHeaders(headerObj = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headerObj)) lower[k.toLowerCase()] = String(v);
  return { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) };
}

function toFetchResponse({ status = 200, json, text, headers }) {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: makeHeaders(headers),
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

/**
 * Builds a 429 rate-limited response, optionally with a Retry-After header.
 * @param {number|string} [retryAfterSeconds] value for the retry-after header
 */
function geminiRateLimited(retryAfterSeconds) {
  const spec = { status: 429, text: 'rate limit exceeded' };
  if (retryAfterSeconds != null) spec.headers = { 'retry-after': String(retryAfterSeconds) };
  return spec;
}

module.exports = {
  mockGeminiFetch,
  toFetchResponse,
  geminiSuccess,
  geminiInputBlocked,
  geminiOutputBlocked,
  geminiRateLimited,
};
