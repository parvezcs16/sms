import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

const LicenseContext = createContext(null);

export function LicenseProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api.get('/license/status');
      setStatus(result);
    } catch {
      setStatus({ state: 'locked', reason: 'status_check_failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activate = async (rawKey) => {
    const result = await api.post('/license/activate', { key: rawKey });
    setStatus(result);
    return result;
  };

  return (
    <LicenseContext.Provider value={{ status, loading, activate, refresh: load }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error('useLicense must be used within LicenseProvider');
  return ctx;
}
