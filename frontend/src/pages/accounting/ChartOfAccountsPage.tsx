import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Account {
  id: string;
  code: string;
  name: string;
  accountClass: string;
  normalBalance: string;
  postingAllowed: boolean;
  parentAccountId: string | null;
  active: boolean;
  version: number;
}

interface ChartOfAccounts {
  id: string;
  code: string;
  name: string;
}

const ACCOUNT_CLASSES = [
  'ASSET',
  'CONTRA_ASSET',
  'LIABILITY',
  'CONTRA_LIABILITY',
  'EQUITY',
  'CONTRA_EQUITY',
  'REVENUE',
  'CONTRA_REVENUE',
  'EXPENSE',
  'PROFIT_LOSS',
  'TAX_EXPENSE',
  'OFF_BALANCE',
];

/** Chart of Accounts — tenant-wide (spec section 7): a single adopted
 * AZ_STANDARD chart per tenant, cloned server-side via POST
 * /accounting/chart/adopt (idempotent — safe to call again). This page
 * offers that adoption plus a plain list + create form for accounts,
 * mirroring every other catalog page's list+inline-form pattern. */
export function ChartOfAccountsPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [chart, setChart] = useState<ChartOfAccounts | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountClass, setAccountClass] = useState('ASSET');
  const [normalBalance, setNormalBalance] = useState('DEBIT');
  const [parentAccountId, setParentAccountId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const c = await api.get<ChartOfAccounts | null>('/accounting/chart').catch(() => null);
      setChart(c);
      const a = await api.get<Account[]>('/accounting/accounts?includeInactive=true').catch(() => []);
      setAccounts(a);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = async () => {
    setBusy(true);
    try {
      const c = await api.post<ChartOfAccounts>('/accounting/chart/adopt');
      showSuccess(t.toast.createdItem(c.name));
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post<Account>('/accounting/accounts', {
        code,
        name,
        accountClass,
        normalBalance,
        parentAccountId: parentAccountId || undefined,
      });
      showSuccess(t.toast.createdItem(code));
      setCode('');
      setName('');
      setParentAccountId('');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="panel-note">{t.common.loading}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.chartOfAccounts}</h1>
        {!chart && hasPermission('accounting.chart.manage') && (
          <button className="primary" disabled={busy} onClick={adopt}>
            {t.accounting.adoptChart}
          </button>
        )}
        {chart && hasPermission('accounting.account.create') && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : t.accounting.newAccount}
          </button>
        )}
      </div>

      {!chart ? (
        <p className="panel-note">{t.accounting.noChartYet}</p>
      ) : (
        <>
          <p className="panel-note">
            {chart.code} — {chart.name}
          </p>

          {showForm && (
            <form onSubmit={create} className="card">
              <div className="inline-form">
                <label>
                  {t.common.code}
                  <input required value={code} onChange={(e) => setCode(e.target.value)} />
                </label>
                <label>
                  {t.common.name}
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {t.accounting.accountClass}
                  <select value={accountClass} onChange={(e) => setAccountClass(e.target.value)}>
                    {ACCOUNT_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.accounting.normalBalance}
                  <select value={normalBalance} onChange={(e) => setNormalBalance(e.target.value)}>
                    <option value="DEBIT">DEBIT</option>
                    <option value="CREDIT">CREDIT</option>
                    <option value="BOTH">BOTH</option>
                  </select>
                </label>
                <label>
                  {t.accounting.parentAccount}
                  <select value={parentAccountId} onChange={(e) => setParentAccountId(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {accounts.length === 0 ? (
            <p className="panel-note">{t.accounting.noAccountsYet}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.accounting.accountClass}</th>
                  <th>{t.accounting.normalBalance}</th>
                  <th>{t.accounting.postingAllowed}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.accountClass}</td>
                    <td>{a.normalBalance}</td>
                    <td>{a.postingAllowed ? t.common.yes : t.common.no}</td>
                    <td>{a.active ? t.catalog.active : t.catalog.inactive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
