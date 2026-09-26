// Ported from client/src/api.ts (docs/mobile-app-plan.md §9, §16). Request/
// refresh-dedup logic is unchanged; the only real difference is that
// getToken/getRefreshToken are async here (SecureStore, not localStorage —
// see ./session.ts), so every call site awaits them where the web version
// read them synchronously.
import { API_BASE } from '../config';
import { getToken, getRefreshToken, setSession } from './session';

export class ApiError extends Error {
  status: number;
  /** The server's machine-readable error code, e.g. 'RATE_LIMITED' (see api()). */
  code?: string;
  /** Epoch ms — set only when every Gemini API key is currently exhausted;
   *  the soonest any key recovers. Parsed from the server's `retryAt` ISO
   *  string. See lib/useRetryCountdown.ts. */
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
    const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const message = (body && typeof body.error === 'string' ? body.error : null) || `Request failed (${res.status}).`;
    const code = body && typeof body.code === 'string' ? body.code : undefined;
    const retryAtRaw = body && typeof body.retryAt === 'string' ? Date.parse(body.retryAt) : NaN;
    const retryAt = Number.isNaN(retryAtRaw) ? undefined : retryAtRaw;
    throw new ApiError(message, res.status, { code, retryAt });
  }

  return data as T;
}
