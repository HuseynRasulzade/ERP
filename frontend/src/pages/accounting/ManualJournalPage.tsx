import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

interface Account {
  id: string;
  code: string;
  name: string;
}

interface ManualLine {
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: string;
  description?: string;
}

interface JournalEntry {
  id: string;
  journalNumber: string;
  businessDate: string;
  description: string | null;
  status: string;
  version: number;
  lines?: { accountId: string; side: string; amountBase: string; account?: { code: string; name: string } }[];
}

const emptyLine = (): ManualLine => ({ accountId: '', side: 'DEBIT', amountBase: '' });

export function ManualJournalPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<ManualLine[]>([emptyLine(), emptyLine()]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!currentOrganizationId) return;
    try {
      const [acc, list] = await Promise.all([
        api.get<Account[]>('/accounting/accounts'),
        api.get<JournalEntry[]>(`/organizations/${currentOrganizationId}/manual-operations`),
      ]);
      setAccounts(acc.filter((a: any) => a.postingAllowed !== false));
      setEntries(list);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const totalDebit = lines.reduce((s, l) => s + (l.side === 'DEBIT' ? Number(l.amountBase || 0) : 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.side === 'CREDIT' ? Number(l.amountBase || 0) : 0), 0);
  const balanced = lines.length >= 2 && totalDebit > 0 && totalDebit === totalCredit;

  const updateLine = (i: number, patch: Partial<ManualLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!currentOrganizationId) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/manual-operations`, {
        businessDate,
        description: description || undefined,
        lines: lines.filter((l) => l.accountId && Number(l.amountBase) > 0),
      });
      showSuccess('Manual journal entry created (draft)');
      setDescription('');
      setLines([emptyLine(), emptyLine()]);
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const post = async (entry: JournalEntry) => {
    setBusyId(entry.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/manual-operations/${entry.id}/post`, {
        expectedVersion: entry.version,
      });
      showSuccess('Journal entry posted');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (organizations.length === 0) return <p className="empty-hint">Create an organization first.</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Manual Journal Entries</h1>
      </div>

      {hasPermission('accounting.manual_operation.create') && (
        <div className="card">
          <h3>New manual operation</h3>
          <div className="inline-form">
            <label>
              Business date
              <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Accrual adjustment" />
            </label>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Side</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })}>
                      <option value="">Select account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={l.side} onChange={(e) => updateLine(i, { side: e.target.value as 'DEBIT' | 'CREDIT' })}>
                      <option value="DEBIT">Debit</option>
                      <option value="CREDIT">Credit</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={l.amountBase}
                      onChange={(e) => updateLine(i, { amountBase: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            + Add line
          </button>
          <p>
            Debit total: <strong>{totalDebit.toFixed(2)}</strong> — Credit total: <strong>{totalCredit.toFixed(2)}</strong>{' '}
            {!balanced && <span style={{ color: 'var(--color-danger, #c0392b)' }}>(must balance before posting)</span>}
          </p>
          <button onClick={submit} disabled={!balanced}>
            Create as draft
          </button>
        </div>
      )}

      <h3>Existing entries</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Journal #</th>
            <th>Date</th>
            <th>Description</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.journalNumber}</td>
              <td>{e.businessDate.slice(0, 10)}</td>
              <td>{e.description ?? '—'}</td>
              <td>{e.status}</td>
              <td>
                {e.status === 'DRAFT' && hasPermission('accounting.journal.post') && (
                  <button disabled={busyId === e.id} onClick={() => post(e)}>
                    Post
                  </button>
                )}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-hint">
                No manual journal entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
