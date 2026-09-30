import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setSession, getToken, getRefreshToken, TOKEN_KEY } from './api';
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
  const reconcile = useCallback(async () => {
    const id = ++reconcileIdRef.current;
    if (!getToken()) {
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
      // Covers "no session" and "refresh token expired/revoked" (api()'s silent refresh already failed).
      setSession(null, null);
      if (id === reconcileIdRef.current) {
        setUser(null);
        setFeatureFlags(null);
      }
    } finally {
      if (id === reconcileIdRef.current) setLoading(false);
    }
  }, []);

  // Restore the session from a stored token on first load.
  useEffect(() => {
    reconcile();
  }, [reconcile]);

  // Cross-tab session sync. The 'storage' event fires only in OTHER same-origin tabs, so this reacts to another tab's
  // sign-in/out and can't loop on its own writes. The tab that performs the login/logout updates its own state directly.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // Ignore sessionStorage events; this only cares about the localStorage that setSession() writes.
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      if (!shouldResyncAuthOnStorageEvent(event.key, TOKEN_KEY)) return;
      reconcile();
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
      setSession(res.token, res.refreshToken);
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
  const register = useCallback(async (c: RegisterCredentials): Promise<AuthOutcome> => {
    await api<{ status: string }>('/auth/register', { method: 'POST', body: c, auth: false });
    return authenticate('/auth/login', { email: c.email, password: c.password });
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
    const refreshToken = getRefreshToken();
    setSession(null, null);
    setUser(null);
    setFeatureFlags(null);
    if (refreshToken) {
      api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => {});
    }
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
