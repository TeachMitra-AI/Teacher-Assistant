import { API_BASE } from './config';

// Exported so auth.tsx's cross-tab 'storage' listener can recognize which
// localStorage key is the identity-bearing one (see lib/authStorageSync.ts) —
// single source of truth for the key name, rather than a second literal
// string living in auth.tsx.
export const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

// Access token and refresh token are always set/cleared together — there's
// no valid state with only one of the two, so this is the only way either
// is written.
export function setSession(token: string | null, refreshToken: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** The server's machine-readable error code, e.g. 'RATE_LIMITED' (see api()). */
  code?: string;
  /** Epoch ms — set only when every Gemini API key is currently exhausted;
   *  the soonest any key recovers. Parsed from the server's `retryAt` ISO
   *  string. See hooks/useRetryCountdown.ts. */
  retryAt?: number;
  constructor(message: string, status: number, extra?: { code?: string; retryAt?: number }) {
    super(message);
    this.status = status;
    this.code = extra?.code;
    this.retryAt = extra?.retryAt;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function rawRequest(
  path: string,
  options: RequestOptions,
  token: string | null
): Promise<{ res: Response; data: unknown }> {
  const { method = 'GET', body } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  // A FormData body sets its own multipart Content-Type (with the boundary
  // the browser generates) — setting it here would strip that boundary and
  // break parsing server-side. Every existing JSON caller is unaffected: this
  // branch only changes behavior for a body that is already a FormData
  // instance, which no caller passed before the attachments feature.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error. Please check your connection.', 0);
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { res, data };
}

// De-dupes concurrent refresh attempts — if several requests all hit a 401
// at once (e.g. right as the access token expires), only one /auth/refresh
// call is made and everyone waits on it.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const { res, data } = await rawRequest('/auth/refresh', { method: 'POST', body: { refreshToken } }, null);
        if (!res.ok) {
          setSession(null, null);
          return false;
        }
        const parsed = data as { token: string; refreshToken: string };
        setSession(parsed.token, parsed.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// For a binary/CSV response, which api<T>() can't return (it always tries
// to JSON.parse the body). Mirrors api<T>()'s auth header + one-shot 401
// refresh-and-retry, but hands back the raw blob and a filename parsed from
// Content-Disposition, for a caller to trigger a browser download with.
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const fetchOnce = () => fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });

  let res = await fetchOnce();
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await fetchOnce();
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string') message = data.error;
    } catch {
      // Not a JSON error body — keep the generic message.
    }
    throw new ApiError(message, res.status);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { blob: await res.blob(), filename: match ? match[1] : null };
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true } = options;

  let { res, data } = await rawRequest(path, options, auth ? getToken() : null);

  // A short-lived access token expiring mid-session is expected, not an
  // error — silently refresh once and retry before surfacing a failure.
  if (res.status === 401 && auth && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      ({ res, data } = await rawRequest(path, options, getToken()));
    }
  }

  if (!res.ok) {
    const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const message = (body && typeof body.error === 'string' ? body.error : null) || `Request failed (${res.status}).`;
    const code = body && typeof body.code === 'string' ? body.code : undefined;
    const retryAtRaw = body && typeof body.retryAt === 'string' ? Date.parse(body.retryAt) : NaN;
    const retryAt = Number.isNaN(retryAtRaw) ? undefined : retryAtRaw;
    throw new ApiError(message, res.status, { code, retryAt });
  }

  return data as T;
}
