import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const { data } = await api.get<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Register a global 401 handler: when any request is rejected with 401
  // (other than the /auth/me boot probe), clear the user and bounce them
  // to the login page rather than silently returning empty data.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      navigate('/login', { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const login = async (username: string, password: string) => {
    const { data } = await api.post<{ user: User }>('/auth/login', { username, password });
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      navigate('/login', { replace: true });
    }
  };

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
