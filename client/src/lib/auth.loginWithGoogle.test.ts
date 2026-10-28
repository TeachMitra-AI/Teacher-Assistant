import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../api';
import { AuthProvider, useAuth } from '../auth';
import type { AuthOutcome } from '../types';

const apiMock = vi.fn();
const setAccessTokenMock = vi.fn();

// Only the network and session-storage edges are replaced; ApiError stays real so outcomeForError's checks still apply.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
    setAccessToken: (token: string | null) => setAccessTokenMock(token),
    signalSessionChange: vi.fn(),
    getToken: () => null,
    takeLegacyRefreshToken: () => null,
    // No stored session, so the initial restore settles signed-out without calling api().
    restoreSession: vi.fn(async () => 'unauthenticated'),
  };
});

const ID_TOKEN = 'fake-google-id-token-0123456789';
const SESSION = {
  token: 'fake-access-token',
  user: { id: 'u1', name: 'Test Teacher', email: 'teacher@example.com' },
  featureFlags: {},
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AuthProvider, null, children);
}

async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

// Bodies of every POST to /auth/google, in call order.
function googleBodies() {
  return apiMock.mock.calls.filter(([path]) => path === '/auth/google').map(([, opts]) => opts.body);
}

describe('loginWithGoogle', () => {
  beforeEach(() => {
    apiMock.mockReset();
    setAccessTokenMock.mockReset();
  });

  it('sign-up creates the account, then signs in with the token alone', async () => {
    apiMock.mockResolvedValueOnce({ status: 'active' }).mockResolvedValueOnce(SESSION);
    const { result } = await renderAuth();

    let outcome!: AuthOutcome;
    await act(async () => {
      outcome = await result.current.loginWithGoogle(ID_TOKEN, { signup: true, name: 'Test Teacher' });
    });

    expect(outcome).toEqual({ kind: 'signed_in' });
    expect(googleBodies()).toEqual([{ idToken: ID_TOKEN, signup: true, name: 'Test Teacher' }, { idToken: ID_TOKEN }]);
    expect(setAccessTokenMock).toHaveBeenCalledWith('fake-access-token');
    expect(result.current.user).toEqual(SESSION.user);
  });

  it('a sign-up response without a session never counts as signed in', async () => {
    // The follow-up sign-in fails; the sign-up's tokenless 201 alone must not set a session.
    apiMock
      .mockResolvedValueOnce({ status: 'active' })
      .mockRejectedValueOnce(new ApiError('Google sign-in failed. Please try again.', 401));
    const { result } = await renderAuth();

    await act(async () => {
      await expect(result.current.loginWithGoogle(ID_TOKEN, { signup: true })).rejects.toMatchObject({ status: 401 });
    });

    expect(setAccessTokenMock).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it('sign-in without options makes a single request', async () => {
    apiMock.mockResolvedValueOnce(SESSION);
    const { result } = await renderAuth();

    let outcome!: AuthOutcome;
    await act(async () => {
      outcome = await result.current.loginWithGoogle(ID_TOKEN);
    });

    expect(outcome).toEqual({ kind: 'signed_in' });
    expect(googleBodies()).toEqual([{ idToken: ID_TOKEN }]);
  });

  it('the school-picker retry is a single sign-in carrying schoolId', async () => {
    apiMock.mockResolvedValueOnce(SESSION);
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.loginWithGoogle(ID_TOKEN, { schoolId: 'school-1' });
    });

    expect(googleBodies()).toEqual([{ idToken: ID_TOKEN, schoolId: 'school-1' }]);
  });

  it('a sign-up conflict (409) surfaces its message and does not sign in', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError('An account with this email already exists at this school. Please sign in instead.', 409)
    );
    const { result } = await renderAuth();

    await act(async () => {
      await expect(result.current.loginWithGoogle(ID_TOKEN, { signup: true })).rejects.toMatchObject({ status: 409 });
    });

    expect(googleBodies()).toHaveLength(1);
    expect(setAccessTokenMock).not.toHaveBeenCalled();
  });

  it('sign-up against a server without Google configured is "unavailable"', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('google_not_configured', 503));
    const { result } = await renderAuth();

    let outcome!: AuthOutcome;
    await act(async () => {
      outcome = await result.current.loginWithGoogle(ID_TOKEN, { signup: true });
    });

    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(googleBodies()).toHaveLength(1);
  });

  it('sign-up followed by a school picker returns needs_school', async () => {
    const schools = [
      { id: 's1', name: 'School One', code: 'ONE' },
      { id: 's2', name: 'School Two', code: 'TWO' },
    ];
    apiMock.mockResolvedValueOnce({ status: 'active' }).mockResolvedValueOnce({ needsSchoolSelection: true, schools });
    const { result } = await renderAuth();

    let outcome!: AuthOutcome;
    await act(async () => {
      outcome = await result.current.loginWithGoogle(ID_TOKEN, { signup: true });
    });

    expect(outcome).toEqual({ kind: 'needs_school', schools });
  });

  it('sign-in for an unknown Google identity is "not_registered"', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('google_not_registered', 404));
    const { result } = await renderAuth();

    let outcome!: AuthOutcome;
    await act(async () => {
      outcome = await result.current.loginWithGoogle(ID_TOKEN);
    });

    expect(outcome).toEqual({ kind: 'not_registered' });
  });
});
