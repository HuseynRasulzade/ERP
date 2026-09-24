import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface CashFlowCategoryRow {
  category: string;
  inflow: string;
  outflow: string;
}

interface CashFlowReport {
  fromDate: string;
  toDate: string;
  bank: { inflow: string; outflow: string; net: string; lineCount: number };
  cash: { byCategory: CashFlowCategoryRow[]; inflow: string; outflow: string; net: string };
  totalInflow: string;
  totalOutflow: string;
  netCashFlow: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  CUSTOMER_PAYMENT: 'Customer payments',
  SUPPLIER_PAYMENT: 'Supplier payments',
  OTHER_INCOME: 'Other income',
  OTHER_EXPENSE: 'Other expense',
};

function defaultFromDate() {
  return new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Pul vəsaitlərinin hərəkəti (Cash Flow Statement) — direct method, built
 * from real bank/cashbox movements (BankStatementLine + CashTransaction),
 * not from GL postings. Simple two-section layout (Bank / Cash) rather
 * than a full operating/investing/financing breakdown — see
 * CashFlowReportService's docstring for why. */
export function CashFlowPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError } = useToast();

  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(defaultToDate());
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) { setReport(null); return; }
    setLoading(true);
    try {
      setReport(await api.get<CashFlowReport>(`/organizations/${orgId}/cash-flow?fromDate=${fromDate}&toDate=${toDate}`));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('treasury.cash_flow.view')) return <p className="panel-note">You do not have permission to view this report.</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Cash Flow Statement</h1>
      </div>

      <div className="inline-form">
        <label>
          Organization
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>Select…</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <button className="primary" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {!orgId ? (
        <p className="panel-note">Select an organization to view this report.</p>
      ) : !report ? (
        <p className="panel-note">Loading…</p>
      ) : (
        <>
          <section className="card">
            <h2>Bank</h2>
            <dl className="kv-grid">
              <dt>Inflow</dt><dd className="numeric">{report.bank.inflow}</dd>
              <dt>Outflow</dt><dd className="numeric">{report.bank.outflow}</dd>
              <dt>Net</dt><dd className="numeric">{report.bank.net}</dd>
              <dt>Statement lines in period</dt><dd className="numeric">{report.bank.lineCount}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Cash (Kassa)</h2>
            <table className="data-table">
              <thead>
                <tr><th>Category</th><th>Inflow</th><th>Outflow</th></tr>
              </thead>
              <tbody>
                {report.cash.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{CATEGORY_LABEL[c.category] ?? c.category}</td>
                    <td className="numeric">{c.inflow}</td>
                    <td className="numeric">{c.outflow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="kv-grid">
              <dt>Inflow</dt><dd className="numeric">{report.cash.inflow}</dd>
              <dt>Outflow</dt><dd className="numeric">{report.cash.outflow}</dd>
              <dt>Net</dt><dd className="numeric">{report.cash.net}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Total</h2>
            <dl className="kv-grid">
              <dt>Total inflow</dt><dd className="numeric">{report.totalInflow}</dd>
              <dt>Total outflow</dt><dd className="numeric">{report.totalOutflow}</dd>
              <dt>Net cash flow</dt><dd className="numeric">{report.netCashFlow}</dd>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
