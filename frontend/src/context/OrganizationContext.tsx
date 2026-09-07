import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { Organization } from '../api/types';
import { useAuth } from './AuthContext';

interface OrganizationContextValue {
  organizations: Organization[];
  currentOrganizationId: string | null;
  currentOrganization: Organization | null;
  loading: boolean;
  selectOrganization: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

const STORAGE_KEY = 'currentOrganizationId';

/**
 * Section 21/23: many Phase 1+ operations need TenantContext + Organization
 * Context together. If exactly one organization is accessible, auto-select
 * it; otherwise remember the user's last explicit choice (never silently
 * pick one out of several — section 23).
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { currentTenantId } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentTenantId) {
      setOrganizations([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.get<Organization[]>('/organizations');
      setOrganizations(list);
      setCurrentOrganizationId((prev) => {
        if (prev && list.some((o) => o.id === prev)) return prev;
        const next = list.length === 1 ? list[0].id : null;
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectOrganization = useCallback((id: string | null) => {
    setCurrentOrganizationId(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const currentOrganization = organizations.find((o) => o.id === currentOrganizationId) ?? null;

  const value = useMemo(
    () => ({ organizations, currentOrganizationId, currentOrganization, loading, selectOrganization, refresh }),
    [organizations, currentOrganizationId, currentOrganization, loading, selectOrganization, refresh],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error('useOrganization must be used within OrganizationProvider');
  return ctx;
}
