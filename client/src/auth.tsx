import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  AUTH_SYNC_KEY,
  SESSION_ENDED_EVENT,
  getToken,
  restoreSession,
  setAccessToken,
  signalSessionChange,
  takeLegacyRefreshToken,
} from './api';
import { shouldResyncAuthOnStorageEvent } from './lib/authStorageSync';
import type {
  AuthOutcome,
  AuthResponse,
  FeatureFlags,
  GoogleAuthOptions,
  LoginCredentials,
  RegisterCredentials,
  SchoolOption,
  User,
} from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // Live admin-toggleable flags as of the last session bootstrap; null only before the first response. Callers gating UI
  // should fall back to the matching build-time VITE_* constant in config.ts (a courtesy gate; the server stays authoritative).
  featureFlags: FeatureFlags | null;
  login: (c: LoginCredentials) => Promise<AuthOutcome>;
  register: (c: RegisterCredentials) => Promise<AuthOutcome>;
  loginWithGoogle: (idToken: string, options?: GoogleAuthOptions) => Promise<AuthOutcome>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Sign-in returns either a session or a school picker; this narrows the shared response shape for the caller.
type AuthResponseOrPicker = AuthResponse & { needsSchoolSelection?: boolean; schools?: SchoolOption[] };

// "Pending approval" and "rejected" arrive as 403s with a stable code so the UI can show a dedicated screen for each.
// Anything else stays a thrown ApiError.
function outcomeForError(err: unknown): AuthOutcome | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 403 && err.message === 'pending_approval') return { kind: 'pending' };
  if (err.status === 403 && err.message === 'registration_rejected') return { kind: 'rejected' };
  if (err.status === 403 && err.message === 'account_suspended') return { kind: 'suspended' };
  if (err.status === 404 && err.message === 'google_not_registered') return { kind: 'not_registered' };
  if (err.status === 503 && err.message === 'google_not_configured') return { kind: 'unavailable' };
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);

  // Bumped on every reconciliation attempt (initial restore and cross-tab resync). Checking it after each async step stops a
  // slower, superseded attempt (e.g. two rapid logins in another tab) from clobbering newer state.
  const reconcileIdRef = useRef(0);

  // Reads the current token from storage (never a closure) and syncs user/featureFlags to it. Used for the initial restore
  // and, via the 'storage' listener, when another tab signs in, out or invalidates the session (docs/enterprise-exploratory-qa-report.md).
  // Doesn't touch `loading` after the first call, so a resync or api.ts's background token refresh (tryRefresh) updates
  // identity in place instead of flashing the loading spinner in every open tab.
  // Restores the session. With an in-memory token it just confirms it with /auth/me. Otherwise, and whenever `renew` is set,
  // it renews from the refresh cookie first. A storage event sets `renew`, because another tab's sign-out leaves this tab's
  // in-memory token valid for up to its 15-minute life. Only a genuine 401 signs the user out. A network failure or server
  // error leaves the current state alone, so a flaky connection never logs a teacher out.
  const reconcile = useCallback(async (renew = false) => {
    const id = ++reconcileIdRef.current;
    const isCurrent = () => id === reconcileIdRef.current;
    try {
      if (renew || !getToken()) {
        // The pre-cookie build's refresh token is migrated once here; takeLegacyRefreshToken() returns null afterwards.
        const state = await restoreSession(takeLegacyRefreshToken() ?? undefined);
        if (state === 'unauthenticated') {
          if (isCurrent()) {
            setUser(null);
            setFeatureFlags(null);
          }
          return;
        }
        if (state === 'unavailable') return;
      }
      const res = await api<{ user: User; featureFlags: FeatureFlags }>('/auth/me');
      if (isCurrent()) {
        setUser(res.user);
        setFeatureFlags(res.featureFlags);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && isCurrent()) {
        setUser(null);
        setFeatureFlags(null);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  // Restore the session on first load.
  useEffect(() => {
    reconcile();
  }, [reconcile]);

  // The server ended the session during a call (api.ts): drop the user now rather than leaving a signed-in-looking UI.
  useEffect(() => {
    // Only clears the user. It must not bump reconcileIdRef: the initial restore that just reported the 401 would then be
    // superseded before it sets loading to false, and the app would hang on its loading state.
    function onSessionEnded() {
      setUser(null);
      setFeatureFlags(null);
    }
    window.addEventListener(SESSION_ENDED_EVENT, onSessionEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onSessionEnded);
  }, []);

  // Cross-tab session sync. The 'storage' event fires only in OTHER same-origin tabs, so this reacts to another tab's
  // sign-in/out and can't loop on its own writes. The tab that performs the login/logout updates its own state directly.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // Ignore sessionStorage events; this only cares about the localStorage that signalSessionChange() writes.
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      if (!shouldResyncAuthOnStorageEvent(event.key, AUTH_SYNC_KEY)) return;
      reconcile(true);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reconcile]);

  // Shared tail of every sign-in path (password and Google): store the session or return the non-success outcome.
  const authenticate = useCallback(async (path: string, body: unknown): Promise<AuthOutcome> => {
    try {
      const res = await api<AuthResponseOrPicker>(path, { method: 'POST', body, auth: false });
      if (res.needsSchoolSelection) {
        return { kind: 'needs_school', schools: res.schools ?? [] };
      }
      // Invalidate any in-flight reconcile() so a stale response can't overwrite the identity just signed in.
      reconcileIdRef.current += 1;
      setAccessToken(res.token);
      signalSessionChange();
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

  // Registration creates an active account server-side, then signs in via authenticate(), so a future pending/rejected
  // result still gets its dedicated screen.
  // A duplicate address gets the same 201 as a new one (routes/auth.js), so the sign-in below is where a mismatch shows. Its
  // message points to sign-in without confirming that the account exists.
  const register = useCallback(async (c: RegisterCredentials): Promise<AuthOutcome> => {
    await api<{ status: string }>('/auth/register', { method: 'POST', body: c, auth: false });
    try {
      return await authenticate('/auth/login', { email: c.email, password: c.password });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new ApiError('We could not create your account. If you already have one, sign in instead.', 401);
      }
      throw err;
    }
  }, [authenticate]);

  // Serves Google sign-up and sign-in via one endpoint; `signup: true` makes it a sign-up (the server assigns a default school).
  const loginWithGoogle = useCallback(
    (idToken: string, options: GoogleAuthOptions = {}) =>
      authenticate('/auth/google', { idToken, ...options }),
    [authenticate]
  );

  const forgotPassword = useCallback(async (email: string) => {
    await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    await api('/auth/reset-password', { method: 'POST', body: { token, password: newPassword }, auth: false });
  }, []);

  const logout = useCallback(() => {
    // Clear local state at once so sign-out feels instant; revoke server-side in the background (best-effort, a failure
    // doesn't roll back). Invalidate any in-flight reconcile() first so it can't resurrect the signed-out user.
    reconcileIdRef.current += 1;
    setAccessToken(null);
    setUser(null);
    setFeatureFlags(null);
    signalSessionChange();
    // The server revokes the session and clears the refresh cookie. Local state is already cleared, so a failure here is harmless.
    api('/auth/logout', { method: 'POST', body: {}, auth: false }).catch(() => {});
  }, []);

  const updateUser = useCallback((next: User) => {
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({
      user,
      featureFlags,
      loading,
      login,
      register,
      loginWithGoogle,
      forgotPassword,
      resetPassword,
      logout,
      updateUser,
    }),
    [user, featureFlags, loading, login, register, loginWithGoogle, forgotPassword, resetPassword, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
