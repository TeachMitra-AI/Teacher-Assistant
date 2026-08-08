import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setSession, getToken, getRefreshToken } from './api';
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

  // Restore the session from a stored token on first load.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const res = await api<{ user: User; featureFlags: FeatureFlags }>('/auth/me');
        if (!cancelled) {
          setUser(res.user);
          setFeatureFlags(res.featureFlags);
        }
      } catch {
        // Covers both "no session" and "refresh token also expired/revoked"
        // (api()'s silent-refresh already tried and failed before this
        // throws) — either way, there's no valid session to restore.
        setSession(null, null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Shared tail of every sign-in path (password and Google alike): store the
  // session, or hand back whichever non-success outcome the server reported.
  const authenticate = useCallback(async (path: string, body: unknown): Promise<AuthOutcome> => {
    try {
      const res = await api<AuthResponseOrPicker>(path, { method: 'POST', body, auth: false });
      if (res.needsSchoolSelection) {
        return { kind: 'needs_school', schools: res.schools ?? [] };
      }
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
