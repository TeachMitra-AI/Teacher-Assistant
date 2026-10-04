import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, restoreSession, setAccessToken, SESSION_ENDED_EVENT, takeLegacyRefreshToken } from '../api';

// The session contract: the access token lives in memory only, the refresh token is a server-set cookie that script never
// sees, and only a real 401 ends a session. A network failure or a 5xx must leave the user signed in.

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('session storage and restore', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('restores a session into memory and writes no token to localStorage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'access-1' }));

    expect(await restoreSession()).toBe('ok');
    expect(getToken()).toBe('access-1');
    expect(localStorage.length).toBe(0);
  });

  it('sends the refresh request with credentials and the cookie-transport header, and no token in the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'access-1' }));

    await restoreSession();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Session-Transport']).toBe('cookie');
    expect(init.body).toBeUndefined();
  });

  it('a 500 from refresh keeps the session: nothing is cleared', async () => {
    setAccessToken('still-valid');
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    expect(await restoreSession()).toBe('unavailable');
    expect(getToken()).toBe('still-valid');
  });

  it('a network failure during refresh keeps the session: nothing is cleared', async () => {
    setAccessToken('still-valid');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await restoreSession()).toBe('unavailable');
    expect(getToken()).toBe('still-valid');
  });

  it('a 401 from refresh is a genuine sign-out: the in-memory token is cleared', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Session not found. Please log in again.' }));

    expect(await restoreSession()).toBe('unauthenticated');
    expect(getToken()).toBeNull();
  });

  it('a refused refresh announces that the session has ended, so the UI can sign the user out', async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Session not found. Please log in again.' }));

    await restoreSession();
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a network failure does not announce a sign-out', async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await restoreSession();
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a 403 from refresh is also treated as a sign-out', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'pending_approval' }));

    expect(await restoreSession()).toBe('unauthenticated');
  });

  it('retries once when refresh loses a rotation race (refresh_conflict), then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Session is refreshing.', code: 'refresh_conflict' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-2' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(500);

    expect(await pending).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe('access-2');
  });

  it('concurrent restores share one refresh request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'access-3' }));

    const [a, b] = await Promise.all([restoreSession(), restoreSession()]);

    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('migrates the pre-cookie refresh token once and removes both legacy keys', () => {
    localStorage.setItem('auth_token', 'old-access');
    localStorage.setItem('refresh_token', 'r'.repeat(30));

    expect(takeLegacyRefreshToken()).toBe('r'.repeat(30));
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(takeLegacyRefreshToken()).toBeNull();
  });
});

describe('request timeout', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('an auth request that never answers fails with a TIMEOUT error instead of hanging', async () => {
    vi.useFakeTimers();
    // Behaves like fetch: it only settles when the abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }))
    );

    const outcome = api('/auth/login', { method: 'POST', body: {}, auth: false }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(15001);
    const err = (await outcome) as { code?: string; status?: number; message: string };

    expect(err).toMatchObject({ code: 'TIMEOUT', status: 0 });
    expect(err.message).toMatch(/took too long/i);
  });

  it('a caller cancel still reports CANCELLED, not TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }))
    );
    const controller = new AbortController();

    const outcome = api('/auth/me', { auth: false, signal: controller.signal }).catch((err) => err);
    controller.abort();

    expect(await outcome).toMatchObject({ code: 'CANCELLED' });
  });
});
