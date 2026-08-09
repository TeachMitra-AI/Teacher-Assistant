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
  // Live, admin-toggleable flags as of the last session bootstrap (initial
  // load or sign-in) — null only before that first response lands. A caller
  // gating UI on one of these should fall back to the matching build-time
  // VITE_* constant in config.ts when this is null, the same "courtesy client
  // gate, server stays authoritative" contract those constants already
  // document (see MessageBubble.tsx).
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

// A successful sign-in returns a session; a sign-in that can't complete yet
// returns a school picker instead. One response shape covers both, so this
// narrows it before the caller has to care.
type AuthResponseOrPicker = AuthResponse & { needsSchoolSelection?: boolean; schools?: SchoolOption[] };

// The server reports "registered, but an admin hasn't approved you" and
// "registration was turned down" as 403s carrying a stable code rather than
// prose, so the UI can show a dedicated screen for each instead of dumping an
// error string into the form. Anything else stays a thrown ApiError.
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

  // Bumped on every reconciliation attempt (the initial mount restore below,
  // and any later cross-tab resync — see the 'storage' listener effect).
  // Checking it after each async step is what replaces the old effect-scoped
  // `cancelled` flag: with two independent call sites now able to trigger a
  // reconcile, a slower response from an attempt that's since been
  // superseded by a newer one (e.g. two rapid logins in another tab) must
  // never win and clobber more current state.
  const reconcileIdRef = useRef(0);

  // Reads the CURRENT token from storage (never a value captured in a
  // closure) and syncs user/featureFlags to match it. Used both for the
  // initial page-load restore and, via the 'storage' listener effect below,
  // to resync this tab's identity when a DIFFERENT tab changes what's in
  // localStorage — sign in as someone else, sign out, or a session that
  // becomes invalid. See docs/enterprise-exploratory-qa-report.md EQA-002.
  //
  // Deliberately does not touch `loading` past the very first call: a
  // cross-tab resync should update the displayed identity/permissions in
  // place, not take over the whole screen with the app's initial loading
  // spinner every time. That matters because api.ts's own silent
  // access-token refresh (tryRefresh) also calls setSession() — a routine,
  // same-user token rotation that happens automatically in the background —
  // and that must not be visually disruptive in every other open tab.
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
      // Covers both "no session" and "refresh token also expired/revoked"
      // (api()'s silent-refresh already tried and failed before this
      // throws) — either way, there's no valid session to restore.
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

  // Cross-tab session sync (EQA-002 fix). The 'storage' event fires in every
  // OTHER same-origin tab whenever localStorage changes, but never in the tab
  // that made the write — so this can only ever be reacting to a DIFFERENT
  // tab's sign-in/out, which also rules out a same-tab feedback loop
  // structurally (not something this handler has to guard against itself).
  // The tab that actually performs a login/logout keeps updating its own
  // state directly via authenticate()/logout() below, unchanged.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // A 'storage' event can in principle be dispatched for sessionStorage
      // too; this app never uses it for anything auth-related, but checking
      // storageArea keeps this listener scoped to exactly what setSession()
      // writes to.
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      if (!shouldResyncAuthOnStorageEvent(event.key, TOKEN_KEY)) return;
      reconcile();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reconcile]);

  // Shared tail of every sign-in path (password and Google alike): store the
  // session, or hand back whichever non-success outcome the server reported.
  const authenticate = useCallback(async (path: string, body: unknown): Promise<AuthOutcome> => {
    try {
      const res = await api<AuthResponseOrPicker>(path, { method: 'POST', body, auth: false });
      if (res.needsSchoolSelection) {
        return { kind: 'needs_school', schools: res.schools ?? [] };
      }
      // Invalidate any reconcile() still in flight (initial mount restore,
      // or a cross-tab resync from the 'storage' listener) so its response —
      // reflecting whatever the token said a moment ago — can never land
      // after this and overwrite the identity just signed in here.
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

  // Registration deliberately never returns a session — the account starts
  // pending, so there is nothing to sign in to yet.
  const register = useCallback(async (c: RegisterCredentials): Promise<AuthOutcome> => {
    await api<{ status: string }>('/auth/register', { method: 'POST', body: c, auth: false });
    return { kind: 'pending' };
  }, []);

  // One call serves Google sign-up and Google sign-in, mirroring the single
  // server endpoint: passing a schoolCode makes it a sign-up.
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
    // Clear local state immediately so sign-out feels instant; tell the
    // server to revoke the session in the background on a best-effort basis
    // (a failure here shouldn't block or roll back the client-side logout).
    // Same reasoning as authenticate() above: invalidate any reconcile() in
    // flight first, so it can't land afterward and resurrect a user we just
    // signed out.
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
