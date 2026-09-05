// Maps a GeminiService failure (see gemini.js) to this API's error-response
// contract: { error, code, requestId, retryAt? }. Never leaks upstream
// details (raw response bodies, stack traces, key/auth internals) — only
// `error.status`/`error.code`/`error.name`/`error.retryAt` are ever read.
//
// Previously duplicated (and drifting) across index.js's /coach handler,
// routes/resources.js, and routes/attachments.js. The user-facing wording for
// SAFETY_BLOCKED and the generic UPSTREAM_UNAVAILABLE fallback is deliberately
// caller-specific (a coach answer, a generated resource, and an attachment
// failure warrant different phrasing), so callers pass those two strings in;
// everything else (RATE_LIMITED, TIMEOUT detection, UPSTREAM_AUTH) is the
// same mapping logic every caller already relied on, now defined once.
function sendAiError(res, error, requestId, messages) {
  const {
    safetyBlockedMessage,
    deadlineExceededMessage = 'The request took too long. Please try again.',
    timeoutMessage = deadlineExceededMessage,
    upstreamUnavailableMessage,
  } = messages;

  // Gemini's own content-safety filters blocked the input or the generated
  // output — an expected, occasional outcome, not a system failure.
  if (error.code === 'INPUT_BLOCKED' || error.code === 'OUTPUT_BLOCKED') {
    return res.status(422).json({ error: safetyBlockedMessage, code: 'SAFETY_BLOCKED', requestId });
  }
  // Overall time budget exhausted (retries + continuations took too long).
  if (error.code === 'DEADLINE_EXCEEDED') {
    return res.status(504).json({ error: deadlineExceededMessage, code: 'TIMEOUT', requestId });
  }
  // Per-call timeout/abort that ultimately failed (no overall-deadline error).
  // The message-includes-'timeout' fallback catches fetch/runtime timeout
  // errors that don't carry the standard TimeoutError/AbortError name.
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || String(error.message).includes('timeout')) {
    return res.status(504).json({ error: timeoutMessage, code: 'TIMEOUT', requestId });
  }
  if (error.status === 429) {
    const body = { error: 'The service is busy. Please try again shortly.', code: 'RATE_LIMITED', requestId };
    // Set only when every Gemini API key is currently exhausted (see
    // gemini.js's key-pool rotation) — the soonest any key recovers, so the
    // client can show the teacher a "back in X" message instead of a dead end.
    if (typeof error.retryAt === 'number') body.retryAt = new Date(error.retryAt).toISOString();
    return res.status(429).json(body);
  }
  if (error.status === 401 || error.status === 403) {
    // Do not leak configuration details to the client.
    return res.status(502).json({ error: 'Upstream authentication error. Please contact the administrator.', code: 'UPSTREAM_AUTH', requestId });
  }
  // Everything else (upstream 5xx exhausted, network failure, budget
  // exhaustion, malformed response) → generic upstream failure. Status 502
  // preserved for backward compatibility; `code` distinguishes the cause.
  return res.status(502).json({ error: upstreamUnavailableMessage, code: 'UPSTREAM_UNAVAILABLE', requestId });
}

module.exports = { sendAiError };
