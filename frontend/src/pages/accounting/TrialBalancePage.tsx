import { useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';

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

function fmt(v: string) {
  const n = Number(v);
  return n === 0 ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function TrialBalancePage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { showError } = useToast();
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [rows, setRows] = useState<TrialBalanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const data = await api.get<TrialBalanceRow[]>(
        `/organizations/${currentOrganizationId}/accounting/trial-balance?fromDate=${fromDate}&toDate=${toDate}`,
      );
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      closingDebit: acc.closingDebit + Number(r.closingDebit),
      closingCredit: acc.closingCredit + Number(r.closingCredit),
    }),
    { closingDebit: 0, closingCredit: 0 },
  );

  return (
    <div>
      <div className="page-header">
        <h1>Trial Balance</h1>
      </div>

      {organizations.length === 0 ? (
        <p className="empty-hint">Create an organization first.</p>
      ) : (
        <>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Running…' : 'Run report'}
            </button>
          </form>

          {rows !== null && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Opening Dr</th>
                  <th>Opening Cr</th>
                  <th>Turnover Dr</th>
                  <th>Turnover Cr</th>
                  <th>Closing Dr</th>
                  <th>Closing Cr</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.accountId}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{fmt(r.openingDebit)}</td>
                    <td>{fmt(r.openingCredit)}</td>
                    <td>{fmt(r.turnoverDebit)}</td>
                    <td>{fmt(r.turnoverCredit)}</td>
                    <td>{fmt(r.closingDebit)}</td>
                    <td>{fmt(r.closingCredit)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-hint">
                      No postings in this period yet.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={6}>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{fmt(String(totals.closingDebit))}</strong>
                    </td>
                    <td>
                      <strong>{fmt(String(totals.closingCredit))}</strong>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </>
      )}
    </div>
  );
}
