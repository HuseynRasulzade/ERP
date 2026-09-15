import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { BankAccount, Counterparty, Currency } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface BankPayment {
  id: string;
  number: string;
  documentDate: string;
  direction: 'INCOMING' | 'OUTGOING';
  amount: string;
  currencyId: string;
  bankAccountId: string;
  counterpartyId: string | null;
  reference: string | null;
  postingStatus: string;
  version: number;
}

const emptyForm = () => ({
  direction: 'OUTGOING' as 'INCOMING' | 'OUTGOING',
  bankAccountId: '',
  counterpartyId: '',
  currencyId: '',
  amount: '',
  reference: '',
  documentDate: new Date().toISOString().slice(0, 10),
});

/** Bank payment execution (Treasury, Phase 14). Deliberately separate
 * from Payment Request (approval-side) — this is Layer 2, the actual
 * bank movement, and posts through the same DocumentPostingService
 * every other document type uses (SETTLEMENT_PAYMENT_TYPE). */
export function TreasuryPaymentsPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [payments, setPayments] = useState<BankPayment[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!currentOrganizationId) return;
    try {
      const [pays, accounts, cps, curr] = await Promise.all([
        api.get<BankPayment[]>(`/organizations/${currentOrganizationId}/treasury/payments`).catch(() => []),
        api.get<BankAccount[]>(`/organizations/${currentOrganizationId}/bank-accounts`),
        api.get<Counterparty[]>(`/organizations/${currentOrganizationId}/counterparties`),
        api.get<Currency[]>('/currencies'),
      ]);
      setPayments(pays);
      setBankAccounts(accounts);
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
      await api.post(`/organizations/${currentOrganizationId}/treasury/payments`, {
        direction: form.direction,
        bankAccountId: form.bankAccountId,
        counterpartyId: form.counterpartyId || undefined,
        counterpartyRole: form.counterpartyId ? (form.direction === 'OUTGOING' ? 'SUPPLIER' : 'CUSTOMER') : undefined,
        currencyId: form.currencyId,
        amount: Number(form.amount),
        reference: form.reference || undefined,
        documentDate: form.documentDate,
      });
      showSuccess('Bank payment created (draft)');
      setForm(emptyForm());
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const post = async (p: BankPayment) => {
    setBusyId(p.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payments/${p.id}/post`, { expectedVersion: p.version });
      showSuccess('Payment posted');
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
        <h1>Bank Payments</h1>
      </div>

      {hasPermission('treasury.create_payment') && (
        <form className="inline-form" onSubmit={submit}>
          <label>
            Direction
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'INCOMING' | 'OUTGOING' })}>
              <option value="OUTGOING">Outgoing (pay out)</option>
              <option value="INCOMING">Incoming (receive)</option>
            </select>
          </label>
          <label>
            Bank account
            <select required value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}>
              <option value="">Select…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} — {a.iban}
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
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. invoice #" />
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
            <th>Bank account</th>
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
              <td>{bankAccounts.find((a) => a.id === p.bankAccountId)?.bankName ?? '—'}</td>
              <td>{Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td>{p.postingStatus}</td>
              <td>
                {p.postingStatus === 'NOT_POSTED' && hasPermission('treasury.post_payment') && (
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
                No bank payments yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
