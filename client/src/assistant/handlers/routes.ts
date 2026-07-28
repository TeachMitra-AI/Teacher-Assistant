// AI Action Router — the route strings (Phase 1, Milestone M6).
//
// GUARDRAIL G16: an AI-navigation route string may not appear outside
// client/src/assistant/handlers/. This file and its siblings are the whole of
// that surface — grep for a path anywhere else under assistant/ and the answer
// must be nothing.
//
// The rule is not tidiness. The server never sends a route, a URL or a path; it
// sends an action id and the client maps it. That one-way coupling is what makes
// rolling a new action out to older, service-worker-cached clients safe: the
// worst an unknown id can do is fail to find a mapping here.
//
// A leaf file rather than constants in index.ts, so a handler can name its own
// route without importing the map that imports it.

/** The quiz and worksheet generator. Reached with no parameter, it behaves exactly as it always has. */
export const GENERATOR_ROUTE = '/generator';

/**
 * The query parameter carrying a prefill handle.
 *
 * An OPAQUE draft id and nothing else, ever. The teacher's topic in a query
 * string would land in browser history, referrer headers and every access log
 * between here and the server (G12) — which is why the draft store exists at all.
 */
export const PREFILL_PARAM = 'ai';
