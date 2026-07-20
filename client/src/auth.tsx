import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setSession, getToken, getRefreshToken } from './api';
import type { AuthResponse, User } from './types';

interface Credentials {
  schoolCode: string;
  name: string;
  pin: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (c: Credentials) => Promise<void>;
  register: (c: Credentials) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
        const res = await api<{ user: User }>('/auth/me');
        if (!cancelled) setUser(res.user);
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

  const authenticate = useCallback(async (path: string, c: Credentials) => {
    const res = await api<AuthResponse>(path, { method: 'POST', body: c, auth: false });
    setSession(res.token, res.refreshToken);
    setUser(res.user);
  }, []);

  const login = useCallback((c: Credentials) => authenticate('/auth/login', c), [authenticate]);
  const register = useCallback((c: Credentials) => authenticate('/auth/register', c), [authenticate]);

  const logout = useCallback(() => {
    // Clear local state immediately so sign-out feels instant; tell the
    // server to revoke the session in the background on a best-effort basis
    // (a failure here shouldn't block or roll back the client-side logout).
    const refreshToken = getRefreshToken();
    setSession(null, null);
    setUser(null);
    if (refreshToken) {
      api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => {});
    }
  }, []);

  const updateUser = useCallback((next: User) => {
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser }),
    [user, loading, login, register, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
