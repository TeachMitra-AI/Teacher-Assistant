import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, restoreSession, setAccessToken, SESSION_ENDED_EVENT, takeLegacyRefreshToken } from '../api';

// The session contract: the access token lives in memory only, the refresh token is a server-set cookie that script never
// sees, and only a real 401 ends a session. A network failure or a 5xx must leave the user signed in.

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const conflict = () => jsonResponse(409, { error: 'Session is refreshing.', code: 'refresh_conflict' });

// The longest possible first delay, and the longest possible wait across all four retries.
const MAX_FIRST_DELAY_MS = 600;
const MAX_TOTAL_DELAY_MS = 3600;

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
    vi.restoreAllMocks();
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

  it('retries when refresh loses a rotation race (refresh_conflict), then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-2' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_FIRST_DELAY_MS);

    expect(await pending).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe('access-2');
  });

  it('keeps retrying through repeated conflicts', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-after-conflicts' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_DELAY_MS);

    expect(await pending).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(getToken()).toBe('access-after-conflicts');
  });

  it('gives up as unavailable, without ending the session, well inside the server grace window', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1); // the longest delays
    fetchMock.mockImplementation(async () => conflict());
    setAccessToken('still-here');
    const onEnded = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_DELAY_MS);
    const result = await pending;
    window.removeEventListener(SESSION_ENDED_EVENT, onEnded);

    expect(result).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onEnded).not.toHaveBeenCalled();
    expect(getToken()).toBe('still-here');
  });

  it('waits a growing delay between retries when the random part is smallest', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-timed' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(await pending).toBe('ok');
  });

  it('adds up to 400ms of random delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-jitter' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_FIRST_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(await pending).toBe('ok');
  });

  it('a 401 after a conflict ends the session and stops retrying', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Session has been revoked.' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_DELAY_MS);

    expect(await pending).toBe('unauthenticated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a server error after a conflict stops retrying and keeps the session', async () => {
    vi.useFakeTimers();
    setAccessToken('still-here');
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_DELAY_MS);

    expect(await pending).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe('still-here');
  });

  it('does not retry a 409 that is not a refresh conflict', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'Something else.' }));

    expect(await restoreSession()).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the legacy refresh token on the first attempt only', async () => {
    vi.useFakeTimers();
    const legacyToken = 'r'.repeat(30);
    fetchMock
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonResponse(200, { token: 'access-legacy' }));

    const pending = restoreSession(legacyToken);
    await vi.advanceTimersByTimeAsync(MAX_FIRST_DELAY_MS);

    expect(await pending).toBe('ok');
    expect(String(fetchMock.mock.calls[0][1].body)).toContain(legacyToken);
    expect(String(fetchMock.mock.calls[1][1].body)).not.toContain(legacyToken);
  });

  it('three tabs refreshing at once all restore their session', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.6);

    // The server lets one request rotate the token; anything arriving at that same moment loses.
    let lastRotationAt = -1;
    fetchMock.mockImplementation(async () => {
      const now = Date.now();
      if (now === lastRotationAt) return conflict();
      lastRotationAt = now;
      return jsonResponse(200, { token: `access-${now}` });
    });

    // Each tab has its own copy of the module, so nothing de-dupes across them.
    const loadTab = async () => {
      vi.resetModules();
      return import('../api');
    };
    const tabs = [await loadTab(), await loadTab(), await loadTab()];

    const pending = Promise.all(tabs.map((tab) => tab.restoreSession()));
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_DELAY_MS);

    expect(await pending).toEqual(['ok', 'ok', 'ok']);
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
