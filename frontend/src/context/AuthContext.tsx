import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, session, SESSION_EXPIRED_EVENT } from '../api/client';
import type { Me, MyTenant } from '../api/types';

interface AuthContextValue {
  user: Me | null;
  tenants: MyTenant[];
  currentTenantId: string | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  selectTenant: (tenantId: string) => Promise<void>;
  refreshTenants: () => Promise<MyTenant[]>;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [tenants, setTenants] = useState<MyTenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(session.tenantId);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPermissions = useCallback(async () => {
    if (!session.tenantId) {
      setPermissions([]);
      return;
    }
    try {
      const res = await api.get<{ permissions: string[] }>('/permissions/me');
      setPermissions(res.permissions);
    } catch {
      setPermissions([]);
    }
  }, []);

  const refreshTenants = useCallback(async () => {
    const list = await api.get<MyTenant[]>('/users/me/tenants');
    setTenants(list);
    return list;
  }, []);

  const bootstrap = useCallback(async () => {
    if (!session.accessToken) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<Me>('/users/me');
      setUser(me);
      const list = await refreshTenants();
      if (session.tenantId && list.some((t) => t.tenantId === session.tenantId)) {
        setCurrentTenantId(session.tenantId);
        await loadPermissions();
      } else {
        session.setTenantId(null);
        setCurrentTenantId(null);
      }
    } catch {
      session.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [refreshTenants, loadPermissions]);

  useEffect(() => {
    bootstrap();
    const onExpired = () => {
      setUser(null);
      setCurrentTenantId(null);
      setPermissions([]);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/login',
        { email, password },
        { skipAuth: true, skipTenant: true },
      );
      session.setTokens(res.accessToken, res.refreshToken);
      await bootstrap();
    },
    [bootstrap],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/register',
        { email, password, displayName },
        { skipAuth: true, skipTenant: true },
      );
      session.setTokens(res.accessToken, res.refreshToken);
      await bootstrap();
    },
    [bootstrap],
  );

  const logout = useCallback(() => {
    session.clear();
    setUser(null);
    setTenants([]);
    setCurrentTenantId(null);
    setPermissions([]);
  }, []);

  const selectTenant = useCallback(
    async (tenantId: string) => {
      session.setTenantId(tenantId);
      setCurrentTenantId(tenantId);
      await loadPermissions();
    },
    [loadPermissions],
  );

  const hasPermission = useCallback((code: string) => permissions.includes(code), [permissions]);

  const value = useMemo(
    () => ({
      user,
      tenants,
      currentTenantId,
      permissions,
      loading,
      login,
      register,
      logout,
      selectTenant,
      refreshTenants,
      hasPermission,
    }),
    [user, tenants, currentTenantId, permissions, loading, login, register, logout, selectTenant, refreshTenants, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
