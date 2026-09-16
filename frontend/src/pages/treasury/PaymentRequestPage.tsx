import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface PaymentRequest {
  id: string;
  number: string | null;
  documentDate: string;
  status: string;
  counterpartyId: string;
  purchaseInvoiceId: string;
  amount: string;
  currencyId: string | null;
  description: string | null;
  version: number;
}

const STATUS_CLASS: Record<string, string> = { OPEN: 'ok', FULFILLED: 'neutral', CANCELLED: 'bad' };

export function PaymentRequestListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [items, setItems] = useState<PaymentRequest[]>([]);
  const [invoices, setInvoices] = useState<BizDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [purchaseInvoiceId, setPurchaseInvoiceId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    try {
      const [reqs, invs] = await Promise.all([
        api.get<PaymentRequest[]>(`/organizations/${orgId}/payment-requests`),
        api.get<BizDoc[]>(`/organizations/${orgId}/purchase-invoices`).catch(() => []),
      ]);
      setItems(reqs);
      setInvoices(invs.filter((i) => i.postingStatus === 'POSTED'));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<PaymentRequest>(`/organizations/${orgId}/payment-requests`, {
        purchaseInvoiceId, documentDate, amount: amount ? Number(amount) : undefined, description: description || undefined,
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setPurchaseInvoiceId(''); setAmount(''); setDescription(''); setShowForm(false);
      navigate(`/payment-requests/${created.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('treasury.payment_request.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.paymentRequests}</h1>
        {hasPermission('treasury.payment_request.create') && orgId && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : `+ ${t.common.create}`}</button>
        )}
      </div>

      <div className="inline-form">
        <label>
          {t.common.organization}
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>{t.common.select}</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
          </select>
        </label>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          {showForm && (
            <form onSubmit={onCreate} className="card">
              <div className="inline-form">
                <label>
                  {t.treasury.sourceInvoice}
                  <select required value={purchaseInvoiceId} onChange={(e) => setPurchaseInvoiceId(e.target.value)}>
                    <option value="" disabled>{t.common.select}</option>
                    {invoices.map((i) => (
                      <option key={i.id} value={i.id}>{i.number ?? i.id.slice(0, 8)} — {i.grandTotal ?? i.totalCost ?? ''}</option>
                    ))}
                  </select>
                </label>
                <label>{t.common.documentDate}<input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} /></label>
                <label>{t.common.amount}<input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t.treasury.amountDefaultHint} /></label>
              </div>
              <div className="inline-form">
                <label style={{ flex: 1 }}>{t.common.description}<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
              </div>
              <div className="inline-form">
                <button type="submit" className="primary" disabled={submitting}>{submitting ? t.common.saving : t.common.save}</button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="panel-note">{t.treasury.noPaymentRequests}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{t.common.amount}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/payment-requests/${r.id}`}>{r.number ?? r.id.slice(0, 8)}</Link></td>
                    <td>{r.documentDate.slice(0, 10)}</td>
                    <td className="numeric">{r.amount}</td>
                    <td><span className={`badge badge-generic-${STATUS_CLASS[r.status] ?? 'neutral'}`}>{r.status}</span></td>
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

export function PaymentRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<PaymentRequest | null>(null);
  const [bankAccounts, setBankAccounts] = useState<{ id: string; bankName: string; accountName: string; iban: string }[]>([]);
  const [counterpartyBankAccounts, setCounterpartyBankAccounts] = useState<{ id: string; bankName: string; accountNumber: string; iban: string | null; status: string }[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [counterpartyBankAccountId, setCounterpartyBankAccountId] = useState('');
  const [orderAmount, setOrderAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<PaymentRequest>(`/organizations/${orgId}/payment-requests/${id}`);
      setDoc(d);
      const banks = await api.get<{ id: string; bankName: string; accountName: string; iban: string }[]>(`/organizations/${orgId}/bank-accounts`).catch(() => []);
      setBankAccounts(banks);
      const cp = await api.get<{ bankAccounts?: { id: string; bankName: string; accountNumber: string; iban: string | null; status: string }[] }>(`/organizations/${orgId}/counterparties/${d.counterpartyId}`).catch(() => null);
      setCounterpartyBankAccounts(cp?.bankAccounts ?? []);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => { load(); }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/payment-requests/${doc.id}/cancel`, { expectedVersion: doc.version });
      showSuccess(t.treasury.paymentRequestCancelled);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (!bankAccountId) return;
    setBusy(true);
    try {
      const order = await api.post<{ id: string }>(`/organizations/${orgId}/payment-orders`, {
        paymentRequestId: doc.id, documentDate: new Date().toISOString().slice(0, 10), bankAccountId,
        counterpartyBankAccountId: counterpartyBankAccountId || undefined,
        amount: orderAmount ? Number(orderAmount) : undefined,
      });
      showSuccess(t.treasury.paymentOrderCreated);
      navigate(`/payment-orders/${order.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{doc.number ?? doc.id}</h1>
          <div className="badge-row"><span className={`badge badge-generic-${STATUS_CLASS[doc.status] ?? 'neutral'}`}>{doc.status}</span></div>
        </div>
        <div className="actions">
          <Link to="/payment-requests" className="link-muted">{t.common.backToList}</Link>
          {hasPermission('treasury.payment_request.cancel') && doc.status === 'OPEN' && (
            <button className="danger" disabled={busy} onClick={cancel}>{t.common.cancel}</button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{t.common.documentDate}</dt><dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>{t.common.amount}</dt><dd className="numeric">{doc.amount}</dd>
          <dt>{t.treasury.sourceInvoice}</dt><dd><Link to={`/purchase-invoices/${doc.purchaseInvoiceId}`}>{doc.purchaseInvoiceId.slice(0, 8)}</Link></dd>
        </dl>
      </section>

      {hasPermission('treasury.payment_order.create') && doc.status === 'OPEN' && (
        <section className="card">
          <h2>{t.treasury.createPaymentOrder}</h2>
          <div className="inline-form">
            <label>
              {t.treasury.bankAccount}
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">{t.common.select}</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bankName} — {b.accountName} ({b.iban})</option>)}
              </select>
            </label>
            <label>
              Counterparty's receiving account
              <select value={counterpartyBankAccountId} onChange={(e) => setCounterpartyBankAccountId(e.target.value)}>
                <option value="">{t.common.select} (optional)</option>
                {counterpartyBankAccounts.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.status !== 'APPROVED'}>
                    {b.bankName} — {b.accountNumber} ({b.status}){b.status !== 'APPROVED' ? ' — cannot use until approved' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>{t.common.amount}<input type="number" step="any" min="0" value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} placeholder={doc.amount} /></label>
            <button className="primary" disabled={busy || !bankAccountId} onClick={createOrder}>{t.treasury.createPaymentOrder}</button>
          </div>
        </section>
      )}
    </div>
  );
}
