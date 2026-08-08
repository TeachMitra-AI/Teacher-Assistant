// Resolves an admin-toggleable feature flag's effective value on the client:
// the live value from session bootstrap (auth.tsx's featureFlags, sourced
// from GET/POST /auth/*) when present, else the build-time env constant
// (config.ts) as a safe fallback — e.g. before that bootstrap response has
// landed, or on an older cached bundle whose response shape predates this
// field. Mirrors the server's own precedence in
// routes/learningRepresentation.js's isWithinRollout (DB override, else the
// env default) — see docs/admin-feature-flags-architecture.md.
//
// Extracted as its own pure function (rather than inlined at each call site)
// so it's covered by this project's PURE-LOGIC-only client test runner (see
// vitest.config.ts) — this codebase deliberately has no component-rendering
// test setup yet.
export function resolveFeatureFlag(live: boolean | undefined, staticFallback: boolean): boolean {
  return live ?? staticFallback;
}
