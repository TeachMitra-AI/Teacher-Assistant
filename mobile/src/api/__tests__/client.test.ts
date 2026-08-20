// Covers the request/refresh-dedup logic ported from client/src/api.ts
// (docs/mobile-app-plan.md §23 — "assert exactly one /auth/refresh call even
// under concurrent requests"). No web-side test existed to port (api.ts had
// none), so these are new, per the plan's own instruction.
import { api, ApiError } from '../client';
import { setSession, getToken, getRefreshToken } from '../session';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.has(key) ? (store.get(key) as string) : null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('api()', () => {
  beforeEach(async () => {
    await setSession(null, null);
    globalThis.fetch = jest.fn();
  });

  it('attaches the stored token as an Authorization bearer header', async () => {
    await setSession('my-token', 'my-refresh');
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { hello: 'world' }));

    const result = await api('/me');

    expect(result).toEqual({ hello: 'world' });
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer my-token');
  });

  it('throws an ApiError carrying the server error message and status', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(403, { error: 'Forbidden: not your class' }));

    await expect(api('/classroom/classes/x')).rejects.toMatchObject({
      message: 'Forbidden: not your class',
      status: 403,
    });
  });

  it('wraps a network failure as an ApiError with status 0', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    await expect(api('/anything')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/anything')).rejects.toMatchObject({ status: 0 });
  });

  it('silently refreshes once on a 401 and retries with the new token', async () => {
    await setSession('expired-token', 'valid-refresh-token');

    (globalThis.fetch as jest.Mock).mockImplementation((url: string, init: { headers?: Record<string, string> }) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse(200, { token: 'new-token', refreshToken: 'new-refresh' }));
      }
      if (init?.headers?.Authorization === 'Bearer new-token') {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      return Promise.resolve(jsonResponse(401, { error: 'expired' }));
    });

    const result = await api('/protected');

    expect(result).toEqual({ ok: true });
    expect(await getToken()).toBe('new-token');
    expect(await getRefreshToken()).toBe('new-refresh');
  });

  it('de-dupes concurrent refresh attempts under one shared in-flight promise', async () => {
    await setSession('expired-token', 'valid-refresh-token');

    let refreshCalls = 0;
    (globalThis.fetch as jest.Mock).mockImplementation((url: string, init: { headers?: Record<string, string> }) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(jsonResponse(200, { token: 'new-token', refreshToken: 'new-refresh' }));
      }
      if (init?.headers?.Authorization === 'Bearer new-token') {
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      return Promise.resolve(jsonResponse(401, { error: 'expired' }));
    });

    const [a, b] = await Promise.all([api('/protected'), api('/protected')]);

    expect(refreshCalls).toBe(1);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
  });

  it('clears the stored session when the refresh call itself fails', async () => {
    await setSession('expired-token', 'bad-refresh-token');

    (globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(jsonResponse(401, { error: 'invalid' }));
      return Promise.resolve(jsonResponse(401, { error: 'expired' }));
    });

    await expect(api('/protected')).rejects.toBeInstanceOf(ApiError);
    expect(await getToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });
});
