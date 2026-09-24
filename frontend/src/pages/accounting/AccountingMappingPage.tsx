import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Account {
  id: string;
  code: string;
  name: string;
  postingAllowed: boolean;
}

interface AccountingMapping {
  id: string;
  organizationId: string | null;
  mappingKey: string;
  accountId: string;
  validFrom: string;
  validTo: string | null;
  priority: number;
  active: boolean;
  account?: { id: string; code: string; name: string };
}

/** Every semantic key business modules resolve through
 * AccountingMappingService.resolve(...) (backend/src/accounting-core/
 * accounting-dimension-codes.ts MappingKeys) — kept in sync manually since
 * the backend has no endpoint to list valid keys. */
const MAPPING_KEYS = [
  'CASH', 'BANK', 'MATERIAL_INVENTORY', 'FINISHED_GOODS', 'GOODS_INVENTORY',
  'CUSTOMER_RECEIVABLE', 'SUPPLIER_ADVANCE', 'CUSTOMER_ADVANCE', 'SUPPLIER_PAYABLE',
  'SALES_REVENUE', 'SALES_RETURN', 'SALES_DISCOUNT', 'COGS', 'COMMERCIAL_EXPENSE',
  'ADMIN_EXPENSE', 'OTHER_OPERATING_INCOME', 'OTHER_OPERATING_EXPENSE', 'CURRENT_INCOME_TAX_EXPENSE',
  'VAT_INPUT_RECOVERABLE', 'VAT_INPUT_PENDING', 'VAT_INPUT_NONRECOVERABLE', 'VAT_OUTPUT_PAYABLE',
  'VAT_DEPOSIT_ACCOUNT', 'VAT_SETTLEMENT', 'VAT_ROUNDING', 'VAT_ADJUSTMENT',
  'GOODS_RECEIVED_NOT_INVOICED',
];

/** Phase 4 — Accounting mapping configuration (spec sections 39-43): the
 * rules deciding which GL account each document type resolves to at
 * posting time. A row with organizationId=null is the tenant-wide
 * default; an org-specific row overrides it; ties within the same
 * specificity are broken by priority (an exact tie is a posting-time
 * error, not a silent pick — see AccountingMappingService.resolve). */
export function AccountingMappingPage() {
  const { hasPermission } = useAuth();
  const { organizations } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [mappings, setMappings] = useState<AccountingMapping[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orgFilter, setOrgFilter] = useState('');

  const [mappingKey, setMappingKey] = useState(MAPPING_KEYS[0]);
  const [accountId, setAccountId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [priority, setPriority] = useState('0');
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const load = async (organizationIdFilter?: string) => {
    setLoading(true);
    try {
      const qs = organizationIdFilter ? `?organizationId=${organizationIdFilter}` : '';
      const [m, a] = await Promise.all([
        api.get<AccountingMapping[]>(`/accounting/mappings${qs}`),
        api.get<Account[]>('/accounting/accounts?includeInactive=false').catch(() => []),
      ]);
      setMappings(m);
      setAccounts(a.filter((x) => x.postingAllowed));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(orgFilter || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgFilter]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/accounting/mappings', {
        mappingKey,
        accountId,
        organizationId: organizationId || undefined,
        priority: priority ? Number(priority) : undefined,
        validFrom: validFrom || undefined,
      });
      showSuccess('Saved');
      setAccountId('');
      setPriority('0');
      await load(orgFilter || undefined);
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('accounting.mapping.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.accountingMappings}</h1>
      </div>

      {hasPermission('accounting.mapping.manage') && (
        <form onSubmit={onCreate} className="inline-form">
          <label>
            Mapping key
            <select required value={mappingKey} onChange={(e) => setMappingKey(e.target.value)}>
              {MAPPING_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Account
            <select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="" disabled>{t.common.select}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t.common.organization} (blank = tenant-wide default)
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">-</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
          <label>
            Valid from
            <input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? t.common.saving : t.common.save}
          </button>
        </form>
      )}

      <div className="inline-form">
        <label>
          {t.common.organization} filter
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">All</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : mappings.length === 0 ? (
        <p className="panel-note">No mappings configured yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Mapping key</th>
              <th>Account</th>
              <th>{t.common.organization}</th>
              <th>Priority</th>
              <th>Valid from</th>
              <th>Valid to</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.mappingKey}</td>
                <td>{m.account ? `${m.account.code} — ${m.account.name}` : accounts.find((a) => a.id === m.accountId)?.name ?? m.accountId.slice(0, 8)}</td>
                <td>{m.organizationId ? organizations.find((o) => o.id === m.organizationId)?.name ?? m.organizationId.slice(0, 8) : 'Tenant-wide'}</td>
                <td className="numeric">{m.priority}</td>
                <td>{m.validFrom?.slice(0, 10)}</td>
                <td>{m.validTo?.slice(0, 10) ?? '-'}</td>
                <td>
                  <span className={`badge badge-generic-${m.active ? 'success' : 'neutral'}`}>{m.active ? 'ACTIVE' : 'INACTIVE'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
