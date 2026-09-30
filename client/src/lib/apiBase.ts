// Every backend router mounts under /api (server/src/index.js), so the base URL must end in /api. If VITE_API_BASE points at
// the bare origin, requests hit `<origin>/auth/login` and 404 with nothing saying why. The value is baked in at build time,
// so normalizing it here prevents the mistake instead of needing a rebuild to fix it.
export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}
