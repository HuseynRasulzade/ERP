import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Account {
  id: string;
  code: string;
  name: string;
}

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  openingDebit: string;
  openingCredit: string;
  turnoverDebit: string;
  turnoverCredit: string;
  closingDebit: string;
  closingCredit: string;
}

interface Movement {
  id: string;
  businessDate: string;
  side: string;
  amountBase: string;
  account: { code: string; name: string };
  journalEntry: { journalNumber: string; description: string | null; sourceDocumentType: string | null; sourceDocumentId: string | null };
}

interface FinancialStatementRow {
  accountId: string;
  code: string;
  name: string;
  sectionCode: string | null;
  sectionName: string | null;
  groupCode: string | null;
  groupName: string | null;
  amount: string;
}

function defaultFromDate() {
  return new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Balans Cədvəli (Trial Balance) / Baş Kitab (General Ledger) — read from
 * the immutable AccountingMovement register via the existing
 * AccountingQueryService endpoints, following the exact tab-strip +
 * date-range pattern PurchaseReportsPage already uses. */
export function AccountingReportsPage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { t } = useLocale();

  type Tab = 'trial-balance' | 'general-ledger' | 'income-statement' | 'balance-sheet';
  const location = useLocation();
  const navigate = useNavigate();
  const initialTab: Tab = (['general-ledger', 'income-statement', 'balance-sheet'] as const).includes(location.pathname.slice(1) as any)
    ? (location.pathname.slice(1) as Tab)
    : 'trial-balance';
  const [tab, setTab] = useState<Tab>(initialTab);
  const orgId = currentOrganizationId;

  const selectTab = (next: Tab) => {
    setTab(next);
    navigate(`/${next}`, { replace: true });
  };

  const titleByTab: Record<Tab, string> = {
    'trial-balance': t.nav.trialBalance,
    'general-ledger': t.nav.generalLedger,
    'income-statement': t.nav.incomeStatement,
    'balance-sheet': t.nav.balanceSheet,
  };

  return (
    <div>
      <div className="page-header">
        <h1>{titleByTab[tab]}</h1>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <nav className="tab-strip">
            <button className={tab === 'trial-balance' ? 'tab active' : 'tab'} onClick={() => selectTab('trial-balance')}>
              {t.nav.trialBalance}
            </button>
            <button className={tab === 'general-ledger' ? 'tab active' : 'tab'} onClick={() => selectTab('general-ledger')}>
              {t.nav.generalLedger}
            </button>
            <button className={tab === 'income-statement' ? 'tab active' : 'tab'} onClick={() => selectTab('income-statement')}>
              {t.nav.incomeStatement}
            </button>
            <button className={tab === 'balance-sheet' ? 'tab active' : 'tab'} onClick={() => selectTab('balance-sheet')}>
              {t.nav.balanceSheet}
            </button>
          </nav>

          {tab === 'trial-balance' && hasPermission('accounting.trial_balance.view') && <TrialBalanceTab orgId={orgId} />}
          {tab === 'general-ledger' && hasPermission('accounting.general_ledger.view') && <GeneralLedgerTab orgId={orgId} />}
          {tab === 'income-statement' && hasPermission('accounting.financial_statements.view') && <IncomeStatementTab orgId={orgId} />}
          {tab === 'balance-sheet' && hasPermission('accounting.financial_statements.view') && <BalanceSheetTab orgId={orgId} />}
        </>
      )}
    </div>
  );
}

function useAccountOptions(orgId: string) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    api.get<Account[]>('/accounting/accounts').then(setAccounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  return accounts;
}

function TrialBalanceTab({ orgId }: { orgId: string }) {
  const { showError } = useToast();
  const { t } = useLocale();
  const accounts = useAccountOptions(orgId);

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [accountId, setAccountId] = useState('');
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ fromDate, toDate, ...(accountId ? { accountId } : {}) });
      const data = await api.get<TrialBalanceRow[]>(`/organizations/${orgId}/accounting/trial-balance?${qs}`);
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="inline-form">
        <label>
          {t.accounting.fromDate}
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.toDate}
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.account}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t.accounting.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={loading} onClick={run}>
          {loading ? t.common.loading : t.accounting.runReport}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="panel-note">{t.accounting.noRowsYet}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.code}</th>
                <th>{t.common.name}</th>
                <th>{t.accounting.openingDebit}</th>
                <th>{t.accounting.openingCredit}</th>
                <th>{t.accounting.turnoverDebit}</th>
                <th>{t.accounting.turnoverCredit}</th>
                <th>{t.accounting.closingDebit}</th>
                <th>{t.accounting.closingCredit}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td className="numeric">{r.openingDebit}</td>
                  <td className="numeric">{r.openingCredit}</td>
                  <td className="numeric">{r.turnoverDebit}</td>
                  <td className="numeric">{r.turnoverCredit}</td>
                  <td className="numeric">{r.closingDebit}</td>
                  <td className="numeric">{r.closingCredit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GeneralLedgerTab({ orgId }: { orgId: string }) {
  const { showError } = useToast();
  const { t } = useLocale();
  const accounts = useAccountOptions(orgId);

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [accountId, setAccountId] = useState('');
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ fromDate, toDate, ...(accountId ? { accountId } : {}) });
      const data = await api.get<Movement[]>(`/organizations/${orgId}/accounting/general-ledger?${qs}`);
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="inline-form">
        <label>
          {t.accounting.fromDate}
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.toDate}
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.account}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t.accounting.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={loading} onClick={run}>
          {loading ? t.common.loading : t.accounting.runReport}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="panel-note">{t.accounting.noRowsYet}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.accounting.journalNumber}</th>
                <th>{t.accounting.account}</th>
                <th>{t.accounting.side}</th>
                <th>{t.common.amount}</th>
                <th>{t.common.description}</th>
                <th>{t.accounting.sourceDocument}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.businessDate.slice(0, 10)}</td>
                  <td>{m.journalEntry?.journalNumber}</td>
                  <td>
                    {m.account.code} — {m.account.name}
                  </td>
                  <td>{m.side}</td>
                  <td className="numeric">{m.amountBase}</td>
                  <td>{m.journalEntry?.description ?? '—'}</td>
                  <td>
                    {m.journalEntry?.sourceDocumentType ? `${m.journalEntry.sourceDocumentType} · ${m.journalEntry.sourceDocumentId?.slice(0, 8)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function groupRows(rows: FinancialStatementRow[]) {
  const bySection = new Map<string, { name: string; rows: FinancialStatementRow[]; total: number }>();
  for (const r of rows) {
    const key = r.sectionCode ?? '—';
    const entry = bySection.get(key) ?? { name: r.sectionName ?? '—', rows: [], total: 0 };
    entry.rows.push(r);
    entry.total += Number(r.amount);
    bySection.set(key, entry);
  }
  return Array.from(bySection.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function IncomeStatementTab({ orgId }: { orgId: string }) {
  const { showError } = useToast();
  const { t } = useLocale();

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [rows, setRows] = useState<FinancialStatementRow[]>([]);
  const [totals, setTotals] = useState<{ totalRevenue: string; totalExpense: string; netIncome: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ fromDate, toDate });
      const data = await api.get<{ rows: FinancialStatementRow[]; totalRevenue: string; totalExpense: string; netIncome: string }>(
        `/organizations/${orgId}/accounting/income-statement?${qs}`,
      );
      setRows(data.rows);
      setTotals({ totalRevenue: data.totalRevenue, totalExpense: data.totalExpense, netIncome: data.netIncome });
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="inline-form">
        <label>
          {t.accounting.fromDate}
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.toDate}
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <button className="primary" disabled={loading} onClick={run}>
          {loading ? t.common.loading : t.accounting.runReport}
        </button>
      </div>

      {totals && (
        <section className="card">
          <dl className="kv-grid">
            <dt>{t.accounting.totalRevenue}</dt>
            <dd className="numeric">{totals.totalRevenue}</dd>
            <dt>{t.accounting.totalExpense}</dt>
            <dd className="numeric">{totals.totalExpense}</dd>
            <dt>{t.accounting.netIncome}</dt>
            <dd className="numeric">{totals.netIncome}</dd>
          </dl>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="panel-note">{t.accounting.noRowsYet}</p>
      ) : (
        groupRows(rows).map(([sectionCode, section]) => (
          <section className="card" key={sectionCode}>
            <h2>{section.name}</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.common.amount}</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="numeric">{r.amount}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <strong>{t.common.total}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{section.total.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}

function BalanceSheetTab({ orgId }: { orgId: string }) {
  const { showError } = useToast();
  const { t } = useLocale();

  const [asOfDate, setAsOfDate] = useState(defaultToDate);
  const [rows, setRows] = useState<FinancialStatementRow[]>([]);
  const [totals, setTotals] = useState<{ totalAssets: string; totalLiabilities: string; totalEquity: string; currentPeriodNetIncome: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ asOfDate });
      const data = await api.get<{ rows: FinancialStatementRow[]; totalAssets: string; totalLiabilities: string; totalEquity: string; currentPeriodNetIncome: string }>(
        `/organizations/${orgId}/accounting/balance-sheet?${qs}`,
      );
      setRows(data.rows);
      setTotals({ totalAssets: data.totalAssets, totalLiabilities: data.totalLiabilities, totalEquity: data.totalEquity, currentPeriodNetIncome: data.currentPeriodNetIncome });
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="inline-form">
        <label>
          {t.accounting.asOfDate}
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </label>
        <button className="primary" disabled={loading} onClick={run}>
          {loading ? t.common.loading : t.accounting.runReport}
        </button>
      </div>

      {totals && (
        <section className="card">
          <dl className="kv-grid">
            <dt>{t.accounting.totalAssets}</dt>
            <dd className="numeric">{totals.totalAssets}</dd>
            <dt>{t.accounting.totalLiabilities}</dt>
            <dd className="numeric">{totals.totalLiabilities}</dd>
            <dt>{t.accounting.totalEquity}</dt>
            <dd className="numeric">{totals.totalEquity}</dd>
            <dt>{t.accounting.currentPeriodNetIncome}</dt>
            <dd className="numeric">{totals.currentPeriodNetIncome}</dd>
          </dl>
          <p className="panel-note">{t.accounting.balanceSheetNote}</p>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="panel-note">{t.accounting.noRowsYet}</p>
      ) : (
        groupRows(rows).map(([sectionCode, section]) => (
          <section className="card" key={sectionCode}>
            <h2>{section.name}</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.common.amount}</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="numeric">{r.amount}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <strong>{t.common.total}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{section.total.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
