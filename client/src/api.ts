import { API_BASE } from './config';
import { fallbackErrorMessage } from './lib/apiErrorMessages';

// Where the session lives. The access token is held only in memory, so a page reload has nothing to read. The refresh token
// is an HttpOnly cookie set by the server (scoped to /api/auth), which script can't read at all. A reload restores the
// session by calling /auth/refresh, which the browser answers from that cookie.
let accessToken: string | null = null;

// Written (never with a token) on every sign-in and sign-out. Other tabs listen for it and re-check the session. The value is
// a timestamp, so each write produces a storage event.
export const AUTH_SYNC_KEY = 'auth_session_sync';

// Fired when the server has ended the session (a refresh was refused). AuthProvider listens and signs the user out, so the UI
// stops showing an account whose calls are all failing. Without it, a suspended teacher kept seeing the app until a reload.
export const SESSION_ENDED_EVENT = 'sarastech:session-ended';

// Keys written by the pre-cookie build, when both tokens sat in localStorage. Read once to migrate an existing session, then removed.
const LEGACY_TOKEN_KEY = 'auth_token';
const LEGACY_REFRESH_KEY = 'refresh_token';

// Sent on every /auth/ request. It makes cookie-authenticated routes unreachable from cross-site forms, and tells login and
// refresh to leave the refresh token out of the response body (server: middleware/auth.js).
const SESSION_TRANSPORT_HEADER = 'X-Session-Transport';

// Auth calls are short. A hung request would otherwise leave the sign-in button on "Please wait…" indefinitely. Calls
// outside /auth (the AI endpoints can legitimately run for a minute) keep their own, longer behaviour.
const AUTH_TIMEOUT_MS = 15000;

export function getToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function signalSessionChange() {
  try {
    localStorage.setItem(AUTH_SYNC_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable (private browsing). The other tabs then pick the change up on their next request.
  }
}

// Returns the refresh token an older build left in localStorage, and removes both legacy keys so they never linger.
export function takeLegacyRefreshToken(): string | null {
  try {
    const refreshToken = localStorage.getItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    return refreshToken;
  } catch {
    return null;
  }
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
  /** Overrides the default timeout. Auth calls default to AUTH_TIMEOUT_MS; other calls have no timeout. */
  timeoutMs?: number;
}

async function rawRequest(
  path: string,
  options: RequestOptions,
  token: string | null
): Promise<{ res: Response; data: unknown; parseFailed: boolean }> {
  const { method = 'GET', body, signal } = options;
  const timeoutMs = options.timeoutMs ?? (path.startsWith('/auth/') ? AUTH_TIMEOUT_MS : undefined);
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  // A FormData body sets its own multipart Content-Type (with the boundary); setting it here would break parsing.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (path.startsWith('/auth/')) headers[SESSION_TRANSPORT_HEADER] = 'cookie';

  // One controller serves both the caller's cancel and the timeout, so either aborts the same fetch.
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : undefined;
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
        // The refresh cookie is set by the API origin, so it must be sent cross-origin in development and any split deployment.
        credentials: 'include',
      });
    } catch {
      if (timedOut) {
        throw new ApiError('The request took too long. Please check your connection and try again.', 0, { code: 'TIMEOUT' });
      }
      // The caller's AbortController fired (e.g. "Stop generating"); a distinct code so it isn't shown as a network error.
      if (signal?.aborted) {
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
    let text: string;
    try {
      text = await res.text();
    } catch {
      // The body stalled or dropped mid-read; treated like a failed request, not as a bad response.
      if (timedOut) {
        throw new ApiError('The request took too long. Please check your connection and try again.', 0, { code: 'TIMEOUT' });
      }
      throw new ApiError('Network error. Please check your connection.', 0);
    }
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
        parseFailed = true;
      }
    }
    return { res, data, parseFailed };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

// Outcome of trying to restore a session from the refresh cookie.
//  - ok: a new access token is in memory.
//  - unauthenticated: the server rejected the session (401/403). The caller should treat the user as signed out.
//  - unavailable: a network failure or server error. The session is not known to be bad, so nothing is cleared.
export type SessionRestore = 'ok' | 'unauthenticated' | 'unavailable';

// De-dupes concurrent refreshes: if several requests hit a 401 at once, only one /auth/refresh is made.
let refreshPromise: Promise<SessionRestore> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshOnce(legacyRefreshToken?: string): Promise<SessionRestore> {
  // Two tabs can rotate the cookie at the same moment. The loser gets a retryable 409, and its retry picks up the winner's
  // cookie, so it is retried once rather than treated as a failed session.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    let data: unknown;
    try {
      ({ res, data } = await rawRequest(
        '/auth/refresh',
        { method: 'POST', body: legacyRefreshToken ? { refreshToken: legacyRefreshToken } : undefined },
        null
      ));
    } catch {
      return 'unavailable';
    }

    if (res.ok) {
      accessToken = (data as { token: string }).token;
      return 'ok';
    }
    const code = data && typeof data === 'object' ? (data as { code?: string }).code : undefined;
    if (res.status === 409 && code === 'refresh_conflict' && attempt === 0) {
      await sleep(400);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      accessToken = null;
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
      return 'unauthenticated';
    }
    return 'unavailable';
  }
  return 'unavailable';
}

// Restores or renews the session from the refresh cookie. legacyRefreshToken is only for the one-time migration.
export function restoreSession(legacyRefreshToken?: string): Promise<SessionRestore> {
  if (!refreshPromise) {
    refreshPromise = refreshOnce(legacyRefreshToken).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// For binary/CSV responses, which api<T>() can't return since it JSON.parses. Same auth header and one-shot 401
// refresh-and-retry, but returns the raw blob and the filename from Content-Disposition.
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const fetchOnce = () =>
    fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` }, credentials: 'include' });

  let res = await fetchOnce();
  if (res.status === 401 && (await restoreSession()) === 'ok') {
    res = await fetchOnce();
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
  if (res.status === 401 && auth && (await restoreSession()) === 'ok') {
    ({ res, data, parseFailed } = await rawRequest(path, options, getToken()));
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
