// Ported from client/src/api.ts (docs/mobile-app-plan.md §9, §16). Request/
// refresh-dedup logic is unchanged; the only real difference is that
// getToken/getRefreshToken are async here (SecureStore, not localStorage —
// see ./session.ts), so every call site awaits them where the web version
// read them synchronously.
import { API_BASE } from '../config';
import { getToken, getRefreshToken, setSession } from './session';

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
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  // Same reasoning as the web version: a FormData body sets its own
  // multipart Content-Type (with boundary) — don't override it.
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

// De-dupes concurrent refresh attempts — identical logic to the web client:
// if several requests hit a 401 at once, only one /auth/refresh call fires.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;
      try {
        const { res, data } = await rawRequest('/auth/refresh', { method: 'POST', body: { refreshToken } }, null);
        if (!res.ok) {
          await setSession(null, null);
          return false;
        }
        const parsed = data as { token: string; refreshToken: string };
        await setSession(parsed.token, parsed.refreshToken);
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

  let { res, data } = await rawRequest(path, options, auth ? await getToken() : null);

  // A short-lived access token expiring mid-session is expected, not an
  // error — silently refresh once and retry before surfacing a failure.
  if (res.status === 401 && auth && (await getRefreshToken())) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      ({ res, data } = await rawRequest(path, options, await getToken()));
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
