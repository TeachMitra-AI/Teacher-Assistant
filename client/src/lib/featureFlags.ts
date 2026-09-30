// Resolves an admin-toggleable flag's effective value: the live value from session bootstrap (auth.tsx's featureFlags) when
// present, else the build-time env constant (config.ts), e.g. before the bootstrap lands or on an older cached bundle.
// Mirrors the server's precedence in routes/learningRepresentation.js (DB override, else env default); see
// docs/admin-feature-flags-architecture.md. A pure function so the logic-only test runner covers it.
export function resolveFeatureFlag(live: boolean | undefined, staticFallback: boolean): boolean {
  return live ?? staticFallback;
}
