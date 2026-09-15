import { useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';

interface Movement {
  id: string;
  businessDate: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: string;
  description: string | null;
  account: { code: string; name: string };
  journalEntry: { journalNumber: string; description: string | null; sourceDocumentType: string | null } | null;
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function GeneralLedgerPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { showError } = useToast();
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const data = await api.get<Movement[]>(
        `/organizations/${currentOrganizationId}/accounting/general-ledger?fromDate=${fromDate}&toDate=${toDate}&limit=500`,
      );
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>General Ledger</h1>
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
                  <th>Date</th>
                  <th>Journal #</th>
                  <th>Account</th>
                  <th>Side</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.businessDate.slice(0, 10)}</td>
                    <td>{m.journalEntry?.journalNumber ?? '—'}</td>
                    <td>
                      {m.account.code} {m.account.name}
                    </td>
                    <td>{m.side}</td>
                    <td>{Number(m.amountBase).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>{m.description ?? m.journalEntry?.description ?? '—'}</td>
                    <td>{m.journalEntry?.sourceDocumentType ?? '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-hint">
                      No postings in this period yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
