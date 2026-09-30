// Maps a GeminiService failure to this API's error contract: { error, code, requestId, retryAt? }. Only
// `error.status`/`code`/`name`/`retryAt` are read, so upstream details (bodies, stack traces, key internals) never leak.
// Callers pass their own wording for SAFETY_BLOCKED and the generic UPSTREAM_UNAVAILABLE (coach answer, generated
// resource and attachment failure read differently); the rest of the mapping is shared.
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
  // A per-call timeout/abort. The message check also catches timeout errors without the standard name.
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || String(error.message).includes('timeout')) {
    return res.status(504).json({ error: timeoutMessage, code: 'TIMEOUT', requestId });
  }
  if (error.status === 429) {
    const body = { error: 'The service is busy. Please try again shortly.', code: 'RATE_LIMITED', requestId };
    // Set only when every Gemini key is exhausted: the soonest any recovers, so the client can show "back in X".
    if (typeof error.retryAt === 'number') body.retryAt = new Date(error.retryAt).toISOString();
    return res.status(429).json(body);
  }
  if (error.status === 401 || error.status === 403) {
    // Do not leak configuration details to the client.
    return res.status(502).json({ error: 'Upstream authentication error. Please contact the administrator.', code: 'UPSTREAM_AUTH', requestId });
  }
  // Everything else (upstream 5xx exhausted, network failure, budget exhaustion, malformed response) is a generic
  // upstream failure. Status stays 502 for compatibility; `code` distinguishes the cause.
  return res.status(502).json({ error: upstreamUnavailableMessage, code: 'UPSTREAM_UNAVAILABLE', requestId });
}

module.exports = { sendAiError };
