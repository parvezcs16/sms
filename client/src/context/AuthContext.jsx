import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get('/auth/me');
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (username, password) => {
    const result = await api.post('/auth/login', { username, password });
    setToken(result.token);
    setUser(result.user);
    return result.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  // Permission check mirroring the server: management has everything; anyone
  // else has exactly what's in user.permissions (role defaults + what an
  // Admin / Principal / Super Admin granted them).
  const can = useCallback((module, level = 'view') => {
    if (!user) return false;
    if (user.is_management) return true;
    const have = (user.permissions || {})[module] || 'none';
    const rank = { none: 0, view: 1, manage: 2 };
    return rank[have] >= rank[level];
  }, [user]);

  // Re-read permissions when the window regains focus, so a newly granted
  // permission shows up without logging out.
  useEffect(() => {
    if (!user) return undefined;
    const onFocus = () => { api.get('/auth/me').then(setUser).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user ? user.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh: loadMe, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
