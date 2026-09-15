import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Counterparty, Currency } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface CashDesk {
  id: string;
  code: string;
  name: string;
}

interface CashPayment {
  id: string;
  number: string;
  documentDate: string;
  direction: 'INCOMING' | 'OUTGOING';
  amount: string;
  cashDeskId: string;
  postingStatus: string;
  version: number;
}

const emptyForm = () => ({
  direction: 'OUTGOING' as 'INCOMING' | 'OUTGOING',
  cashDeskId: '',
  counterpartyId: '',
  currencyId: '',
  amount: '',
  reference: '',
  documentDate: new Date().toISOString().slice(0, 10),
});

/** Cash desk receipt/expense orders (Cash module, Phase 13). Same
 * underlying SettlementPayment model as Treasury's bank payments —
 * distinguished only by `cashDeskId` vs `bankAccountId` (no duplicate
 * "CashPayment" entity). */
export function CashPaymentsPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [payments, setPayments] = useState<CashPayment[]>([]);
  const [desks, setDesks] = useState<CashDesk[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!currentOrganizationId) return;
    try {
      const [pays, deskList, cps, curr] = await Promise.all([
        api.get<CashPayment[]>(`/organizations/${currentOrganizationId}/cash/payments`),
        api.get<CashDesk[]>(`/organizations/${currentOrganizationId}/cash/desks`),
        api.get<Counterparty[]>(`/organizations/${currentOrganizationId}/counterparties`),
        api.get<Currency[]>('/currencies'),
      ]);
      setPayments(pays);
      setDesks(deskList);
      setCounterparties(cps);
      setCurrencies(curr);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/cash/payments`, {
        direction: form.direction,
        cashDeskId: form.cashDeskId,
        counterpartyId: form.counterpartyId || undefined,
        counterpartyRole: form.counterpartyId ? (form.direction === 'OUTGOING' ? 'SUPPLIER' : 'CUSTOMER') : undefined,
        currencyId: form.currencyId,
        amount: Number(form.amount),
        reference: form.reference || undefined,
        documentDate: form.documentDate,
      });
      showSuccess(form.direction === 'INCOMING' ? 'Cash receipt order created (draft)' : 'Cash expense order created (draft)');
      setForm(emptyForm());
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const post = async (p: CashPayment) => {
    setBusyId(p.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/cash/payments/${p.id}/post`, { expectedVersion: p.version });
      showSuccess('Payment posted');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (organizations.length === 0) return <p className="empty-hint">Create an organization first.</p>;

  if (desks.length === 0) {
    return (
      <div>
        <div className="page-header">
          <h1>Cash Payments</h1>
        </div>
        <p className="empty-hint">
          No cashboxes yet — create one first under Organization → Cashboxes before recording cash receipts/payments.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Cash Payments</h1>
      </div>

      {hasPermission('cash.create_payment') && (
        <form className="inline-form" onSubmit={submit}>
          <label>
            Direction
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'INCOMING' | 'OUTGOING' })}>
              <option value="OUTGOING">Outgoing (cash expense)</option>
              <option value="INCOMING">Incoming (cash receipt)</option>
            </select>
          </label>
          <label>
            Cashbox
            <select required value={form.cashDeskId} onChange={(e) => setForm({ ...form, cashDeskId: e.target.value })}>
              <option value="">Select…</option>
              {desks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Counterparty
            <select value={form.counterpartyId} onChange={(e) => setForm({ ...form, counterpartyId: e.target.value })}>
              <option value="">—</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select required value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })}>
              <option value="">Select…</option>
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>
            Date
            <input type="date" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} />
          </label>
          <label>
            Reference
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </label>
          <button type="submit">Create</button>
        </form>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Date</th>
            <th>Direction</th>
            <th>Cashbox</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{p.number}</td>
              <td>{p.documentDate.slice(0, 10)}</td>
              <td>{p.direction}</td>
              <td>{desks.find((d) => d.id === p.cashDeskId)?.name ?? '—'}</td>
              <td>{Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td>{p.postingStatus}</td>
              <td>
                {p.postingStatus === 'NOT_POSTED' && hasPermission('cash.post_payment') && (
                  <button disabled={busyId === p.id} onClick={() => post(p)}>
                    Post
                  </button>
                )}
              </td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-hint">
                No cash payments yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
