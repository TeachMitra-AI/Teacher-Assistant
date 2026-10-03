import { API_BASE } from './config';
import { fallbackErrorMessage } from './lib/apiErrorMessages';

// Exported so auth.tsx's cross-tab 'storage' listener can recognize the identity key (lib/authStorageSync.ts).
export const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

// Access and refresh tokens are always set and cleared together, and this is the only place either is written.
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
  /** Epoch ms of the soonest any key recovers; set only when every Gemini API key is exhausted (from the
   *  server's `retryAt`). See hooks/useRetryCountdown.ts. */
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
  /** Lets the caller cancel the in-flight request (e.g. the Composer's Stop button). */
  signal?: AbortSignal;
}

async function rawRequest(
  path: string,
  options: RequestOptions,
  token: string | null
): Promise<{ res: Response; data: unknown; parseFailed: boolean }> {
  const { method = 'GET', body, signal } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  // A FormData body sets its own multipart Content-Type (with the boundary); setting it here would break parsing.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // The caller's AbortController fired (e.g. "Stop generating"); a distinct code so it isn't shown as a network error.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Request cancelled.', 0, { code: 'CANCELLED' });
    }
    throw new ApiError('Network error. Please check your connection.', 0);
  }

  let data: unknown = null;
  // A non-empty body that isn't valid JSON (e.g. a captive wifi portal or misconfigured proxy returning an HTML
  // page with a 200) is distinct from a genuinely empty body (several routes reply 204 with none at all) — only the
  // former is a real parse failure, and api() below turns that into a clear error instead of silently proceeding as
  // if the call had succeeded with no data.
  let parseFailed = false;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
      parseFailed = true;
    }
  }
  return { res, data, parseFailed };
}

// De-dupes concurrent refreshes: if several requests hit a 401 at once, only one /auth/refresh is made.
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

// For binary/CSV responses, which api<T>() can't return since it JSON.parses. Same auth header and one-shot 401
// refresh-and-retry, but returns the raw blob and the filename from Content-Disposition.
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const fetchOnce = () => fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });

  let res = await fetchOnce();
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await fetchOnce();
  }

  if (!res.ok) {
    let message = fallbackErrorMessage(res.status);
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

  let { res, data, parseFailed } = await rawRequest(path, options, auth ? getToken() : null);

  // An expiring access token is expected: refresh once silently and retry before surfacing a failure.
  if (res.status === 401 && auth && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      ({ res, data, parseFailed } = await rawRequest(path, options, getToken()));
    }
  }

  if (!res.ok) {
    const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const message = (body && typeof body.error === 'string' ? body.error : null) || fallbackErrorMessage(res.status);
    const code = body && typeof body.code === 'string' ? body.code : undefined;
    const retryAtRaw = body && typeof body.retryAt === 'string' ? Date.parse(body.retryAt) : NaN;
    const retryAt = Number.isNaN(retryAtRaw) ? undefined : retryAtRaw;
    throw new ApiError(message, res.status, { code, retryAt });
  }

  // A "successful" response whose non-empty body wasn't valid JSON (see rawRequest) is not actually usable — the
  // caller expects a typed object and would otherwise get `null` silently, surfacing later as a confusing crash or
  // blank state far from the real cause.
  if (parseFailed) {
    throw new ApiError('Unexpected response from the server. Please try again.', res.status);
  }

  return data as T;
}
