// Every backend router mounts under /api (server/src/index.js), so the API base
// the client builds requests from MUST end in /api. A deployment that points
// VITE_API_BASE at the bare API origin instead builds `<origin>/auth/login`,
// which matches no route: every request 404s and nothing in the app says why.
// The value is baked in at build time, so the only cure is a rebuild —
// normalizing it here means the mistake cannot be made in the first place.
export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}
