// Ported from client/src/auth.tsx's state machine (docs/mobile-app-plan.md
// §16, §26 Phase 3). Same login/register/loginWithGoogle/logout/reconcile
// shape, talking to the same server routes (§4.1) through mobile/src/api's
// already-async, SecureStore-backed client. Deliberately dropped versus the
// web version: the cross-tab `storage` event listener (auth.tsx:117-136) —
// there are no browser tabs on a phone, so there is nothing to resync with.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { setSession, getToken, getRefreshToken } from '../api/session';
import { getCachedPushToken } from '../lib/push';
import type {
  AuthOutcome,
  AuthResponse,
  FeatureFlags,
  GoogleAuthOptions,
  LoginCredentials,
  RegisterCredentials,
  SchoolOption,
  User,
} from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  featureFlags: FeatureFlags | null;
  login: (c: LoginCredentials) => Promise<AuthOutcome>;
  register: (c: RegisterCredentials) => Promise<AuthOutcome>;
  loginWithGoogle: (idToken: string, options?: GoogleAuthOptions) => Promise<AuthOutcome>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthResponseOrPicker = AuthResponse & { needsSchoolSelection?: boolean; schools?: SchoolOption[] };

// The server reports "registered, but not yet approved" / "registration
// rejected" / "no account for this Google identity" / "Google sign-in not
// configured" as stable-coded errors so the UI can show a dedicated screen
// for each instead of a generic error banner. Identical mapping to
// client/src/auth.tsx's outcomeForError.
function outcomeForError(err: unknown): AuthOutcome | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 403 && err.message === 'pending_approval') return { kind: 'pending' };
  if (err.status === 403 && err.message === 'registration_rejected') return { kind: 'rejected' };
  if (err.status === 404 && err.message === 'google_not_registered') return { kind: 'not_registered' };
  if (err.status === 503 && err.message === 'google_not_configured') return { kind: 'unavailable' };
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);

  // Bumped on every reconcile attempt so a slower, superseded response (e.g.
  // the initial-mount restore landing after an in-progress login already
  // finished) can never clobber more current state. Same guard client/src/auth.tsx
  // uses for its own two call sites (mount restore + cross-tab resync); here
  // there is only the one call site (mount restore), but login/logout still
  // need to invalidate it so a slow restore can't land after a fresh sign-in.
  const reconcileIdRef = useRef(0);

  const reconcile = useCallback(async () => {
    const id = ++reconcileIdRef.current;
    if (!(await getToken())) {
      if (id === reconcileIdRef.current) {
        setUser(null);
        setFeatureFlags(null);
        setLoading(false);
      }
      return;
    }
    try {
      const res = await api<{ user: User; featureFlags: FeatureFlags }>('/auth/me');
      if (id === reconcileIdRef.current) {
        setUser(res.user);
        setFeatureFlags(res.featureFlags);
      }
    } catch {
      // Covers both "no session" and "refresh token also expired/revoked" —
      // api()'s own silent-refresh already tried and failed before this
      // throws. Either way there's no valid session to restore.
      await setSession(null, null);
      if (id === reconcileIdRef.current) {
        setUser(null);
        setFeatureFlags(null);
      }
    } finally {
      if (id === reconcileIdRef.current) setLoading(false);
    }
  }, []);

  // Restore the session from SecureStore on app launch. reconcile()'s own
  // setState calls all happen after its internal `await`s, never
  // synchronously inside this effect body — the lint rule's static check
  // can't see that distinction, so it's silenced here rather than restructured
  // (this is the standard fetch-on-mount pattern, not the synchronous-setState
  // anti-pattern the rule targets).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reconcile();
  }, [reconcile]);

  const authenticate = useCallback(async (path: string, body: unknown): Promise<AuthOutcome> => {
    try {
      const res = await api<AuthResponseOrPicker>(path, { method: 'POST', body, auth: false });
      if (res.needsSchoolSelection) {
        return { kind: 'needs_school', schools: res.schools ?? [] };
      }
      reconcileIdRef.current += 1;
      await setSession(res.token, res.refreshToken);
      setUser(res.user);
      setFeatureFlags(res.featureFlags);
      return { kind: 'signed_in' };
    } catch (err) {
      const outcome = outcomeForError(err);
      if (outcome) return outcome;
      throw err;
    }
  }, []);

  const login = useCallback((c: LoginCredentials) => authenticate('/auth/login', c), [authenticate]);

  // Registration never returns a session — the account starts pending, so
  // there is nothing to sign in to yet.
  const register = useCallback(async (c: RegisterCredentials): Promise<AuthOutcome> => {
    await api<{ status: string }>('/auth/register', { method: 'POST', body: c, auth: false });
    return { kind: 'pending' };
  }, []);

  const loginWithGoogle = useCallback(
    (idToken: string, options: GoogleAuthOptions = {}) => authenticate('/auth/google', { idToken, ...options }),
    [authenticate]
  );

  const forgotPassword = useCallback(async (email: string) => {
    await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
  }, []);

  const logout = useCallback(async () => {
    // Invalidate any reconcile() still in flight (the initial mount restore)
    // so it can't land afterward and resurrect a user we just signed out.
    reconcileIdRef.current += 1;
    const refreshToken = await getRefreshToken();
    // Phase 7b: read BEFORE clearing session state below — this is the same
    // in-memory value NotificationContext.tsx's push-registration effect set,
    // not a network call, so there is no ordering hazard reading it here.
    const deviceToken = getCachedPushToken();
    await setSession(null, null);
    setUser(null);
    setFeatureFlags(null);
    // Revoke server-side on a best-effort basis — a failure here shouldn't
    // block or roll back the client-side logout that already happened above.
    // `deviceToken` unregisters this device's push token in the SAME call
    // (server/src/routes/auth.js's POST /logout, Phase 7b) — null whenever
    // this session never registered one (MOBILE_PUSH_ENABLED off, no
    // permission granted, no Expo project id), in which case the server
    // route's own `if (deviceToken)` branch is simply never taken.
    if (refreshToken) {
      api('/auth/logout', { method: 'POST', body: { refreshToken, deviceToken }, auth: false }).catch(() => {});
    }
  }, []);

  const updateUser = useCallback((next: User) => {
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({ user, featureFlags, loading, login, register, loginWithGoogle, forgotPassword, logout, updateUser }),
    [user, featureFlags, loading, login, register, loginWithGoogle, forgotPassword, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
