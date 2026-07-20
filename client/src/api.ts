import { API_BASE } from './config';

const TOKEN_KEY = 'auth_token';
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
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}
