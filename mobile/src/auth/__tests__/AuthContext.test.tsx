// Covers the Phase 3 auth state machine (docs/mobile-app-plan.md §23):
// successful login, invalid credentials, network failure, session
// restoration on launch (both the happy path and an expired/invalid stored
// session), the needs-school/pending/rejected outcomes, and logout clearing
// the secure session. Concurrent-refresh dedup and refresh-on-401 are
// already covered at the api() layer in ../../api/__tests__/client.test.ts —
// not duplicated here, since AuthContext delegates to that same function.
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../AuthContext';
import { setSession, getToken } from '../../api/session';

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
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

const mockUser = {
  id: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.com',
  role: 'teacher' as const,
  preferences: {},
  school: { id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' },
};
const mockFeatureFlags = { learningRepresentationEnabled: false };

// renderHook() is async in this version of @testing-library/react-native
// (React 19 concurrent rendering, same reason RootNavigator.test.tsx's own
// render() calls are awaited).
async function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> });
}

describe('AuthContext', () => {
  beforeEach(async () => {
    await setSession(null, null);
    globalThis.fetch = jest.fn();
  });

  it('finishes loading with no user when no session is stored', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('restores the session on launch by calling /auth/me when a token is stored', async () => {
    await setSession('valid-token', 'valid-refresh');
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { user: mockUser, featureFlags: mockFeatureFlags })
    );

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.featureFlags).toEqual(mockFeatureFlags);
  });

  it('clears the stored session when restoring fails (expired/revoked refresh token)', async () => {
    await setSession('stale-token', 'dead-refresh');
    // /auth/me 401s, and the api() layer's own refresh attempt also fails.
    (globalThis.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve(jsonResponse(401, { error: url.endsWith('/auth/refresh') ? 'invalid' : 'expired' }))
    );

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(await getToken()).toBeNull();
  });

  it('signs in successfully and stores the session', async () => {
    // No token stored (beforeEach clears the session), so the initial
    // reconcile-on-mount returns early without calling fetch at all.
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { token: 'tok', refreshToken: 'ref', user: mockUser, featureFlags: mockFeatureFlags })
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.login({ email: mockUser.email, password: 'password123' });
    });

    expect(outcome).toEqual({ kind: 'signed_in' });
    expect(result.current.user).toEqual(mockUser);
    expect(await getToken()).toBe('tok');
  });

  it('rejects with an ApiError on invalid credentials, leaving the user signed out', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(401, { error: 'Incorrect email or password.' })
    );

    await expect(
      act(async () => {
        await result.current.login({ email: 'nope@example.com', password: 'wrongpass' });
      })
    ).rejects.toMatchObject({ message: 'Incorrect email or password.', status: 401 });
    expect(result.current.user).toBeNull();
  });

  it('surfaces a network failure as a status-0 ApiError', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(
      act(async () => {
        await result.current.login({ email: mockUser.email, password: 'password123' });
      })
    ).rejects.toMatchObject({ status: 0 });
  });

  it('returns a needs_school outcome for a multi-school account, without signing in', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const schools = [{ id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' }, { id: 's2', name: 'Rampur High', code: 'RAMPUR02' }];
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { needsSchoolSelection: true, schools }));

    let outcome;
    await act(async () => {
      outcome = await result.current.login({ email: mockUser.email, password: 'password123' });
    });

    expect(outcome).toEqual({ kind: 'needs_school', schools });
    expect(result.current.user).toBeNull();
  });

  it('returns a pending outcome after registering, issuing no session', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(201, { status: 'pending' }));

    let outcome;
    await act(async () => {
      outcome = await result.current.register({
        schoolCode: 'RAMPUR01',
        name: 'New Teacher',
        email: 'new@example.com',
        password: 'password123',
      });
    });

    expect(outcome).toEqual({ kind: 'pending' });
    expect(result.current.user).toBeNull();
    expect(await getToken()).toBeNull();
  });

  it('logs out by clearing the secure session and best-effort revoking it server-side', async () => {
    await setSession('tok', 'ref');
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { user: mockUser, featureFlags: mockFeatureFlags })
    );
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(mockUser));

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { success: true }));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.featureFlags).toBeNull();
    expect(await getToken()).toBeNull();
    const logoutCall = (globalThis.fetch as jest.Mock).mock.calls.find(([url]) => url.endsWith('/auth/logout'));
    expect(logoutCall).toBeTruthy();
  });
});
