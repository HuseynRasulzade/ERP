import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Organization } from '../../api/types';
import { useToast } from '../../context/ToastContext';
import { GeneralTab } from './tabs/GeneralTab';
import { BranchesTab } from './tabs/BranchesTab';
import { DepartmentsTab } from './tabs/DepartmentsTab';
import { WarehousesTab } from './tabs/WarehousesTab';
import { CashboxesTab } from './tabs/CashboxesTab';
import { BankAccountsTab } from './tabs/BankAccountsTab';
import { AccountingPoliciesTab } from './tabs/AccountingPoliciesTab';
import { TaxProfilesTab } from './tabs/TaxProfilesTab';
import { AccessTab } from './tabs/AccessTab';

/**
 * Organization management area (section 49): tabbed sections rather than
 * one overcrowded screen — General / Structure (Branches, Departments) /
 * Warehouses / Cashboxes / Bank Accounts / Accounting Policy / Tax Profile
 * / Access.
 */
export function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { showError } = useToast();
  const [org, setOrg] = useState<Organization | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<Organization>(`/organizations/${id}`)
      .then(setOrg)
      .catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!org || !id) return <p className="muted">Loading…</p>;

  const base = `/organizations/${id}`;
  const tabs = [
    { to: base, label: 'General', end: true },
    { to: `${base}/branches`, label: 'Branches' },
    { to: `${base}/departments`, label: 'Departments' },
    { to: `${base}/warehouses`, label: 'Warehouses' },
    { to: `${base}/cashboxes`, label: 'Cashboxes' },
    { to: `${base}/bank-accounts`, label: 'Bank Accounts' },
    { to: `${base}/accounting-policies`, label: 'Accounting Policy' },
    { to: `${base}/tax-profiles`, label: 'Tax Profile' },
    { to: `${base}/access`, label: 'Access' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{org.name}</h1>
          <p className="muted">{org.code}</p>
        </div>
      </div>

      <nav className="tab-strip">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<GeneralTab org={org} onChanged={load} />} />
        <Route path="branches" element={<BranchesTab organizationId={id} />} />
        <Route path="departments" element={<DepartmentsTab organizationId={id} />} />
        <Route path="warehouses" element={<WarehousesTab organizationId={id} />} />
        <Route path="cashboxes" element={<CashboxesTab organizationId={id} />} />
        <Route path="bank-accounts" element={<BankAccountsTab organizationId={id} />} />
        <Route path="accounting-policies" element={<AccountingPoliciesTab organizationId={id} />} />
        <Route path="tax-profiles" element={<TaxProfilesTab organizationId={id} />} />
        <Route path="access" element={<AccessTab organizationId={id} />} />
      </Routes>
    </div>
  );
}
