import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent, Cashbox, SalesCounterpartyRef } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { AccountingEntriesPanel } from '../docs/AccountingEntriesPanel';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

type Category = 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

interface CashTransaction {
  id: string;
  number: string | null;
  documentDate: string;
  status: string;
  postingStatus: string;
  cashboxId: string;
  direction: 'RECEIPT' | 'PAYMENT';
  category: Category;
  counterpartyId: string | null;
  amount: string;
  description: string | null;
  version: number;
}

const CATEGORIES_BY_DIRECTION: Record<'RECEIPT' | 'PAYMENT', Category[]> = {
  RECEIPT: ['CUSTOMER_PAYMENT', 'OTHER_INCOME'],
  PAYMENT: ['SUPPLIER_PAYMENT', 'OTHER_EXPENSE'],
};

interface OpenObligation {
  sourceDocumentId: string;
  remainingAmount: string;
  status: string;
}

export function CashTransactionListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<CashTransaction[]>([]);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashboxId, setCashboxId] = useState('');
  const [direction, setDirection] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT');
  const [category, setCategory] = useState<Category>('CUSTOMER_PAYMENT');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [sourceInvoiceId, setSourceInvoiceId] = useState('');
  const [openObligations, setOpenObligations] = useState<OpenObligation[]>([]);
  const [invoiceNumbers, setInvoiceNumbers] = useState<Record<string, string>>({});

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [txns, cbs, cps] = await Promise.all([
        api.get<CashTransaction[]>(`/organizations/${orgId}/cash-transactions`),
        api.get<Cashbox[]>(`/organizations/${orgId}/cashboxes`).catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
      ]);
      setItems(txns);
      setCashboxes(cbs.filter((c) => c.active));
      setCounterparties(cps);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const requiresCounterparty = category === 'CUSTOMER_PAYMENT' || category === 'SUPPLIER_PAYMENT';
  const eligibleCounterparties = counterparties.filter((c) =>
    category === 'CUSTOMER_PAYMENT' ? c.counterpartyType === 'CUSTOMER' || c.counterpartyType === 'BOTH' : c.counterpartyType === 'SUPPLIER' || c.counterpartyType === 'BOTH',
  );

  const onDirectionChange = (d: 'RECEIPT' | 'PAYMENT') => {
    setDirection(d);
    setCategory(CATEGORIES_BY_DIRECTION[d][0]);
    setCounterpartyId('');
    setSourceInvoiceId('');
    setOpenObligations([]);
  };

  useEffect(() => {
    setSourceInvoiceId('');
    if (!orgId || !counterpartyId || !requiresCounterparty) {
      setOpenObligations([]);
      return;
    }
    const endpoint = category === 'CUSTOMER_PAYMENT' ? 'customer-receivables' : 'supplier-payables';
    const numbersEndpoint = category === 'CUSTOMER_PAYMENT' ? 'sales-invoices' : 'purchase-invoices';
    Promise.all([
      api.get<OpenObligation[]>(`/organizations/${orgId}/${endpoint}?counterpartyId=${counterpartyId}`).catch(() => []),
      api.get<{ id: string; number: string | null }[]>(`/organizations/${orgId}/${numbersEndpoint}`).catch(() => []),
    ]).then(([obligations, invoices]) => {
      setOpenObligations(obligations.filter((o) => o.status !== 'PAID' && o.status !== 'CANCELLED' && Number(o.remainingAmount) > 0));
      setInvoiceNumbers(Object.fromEntries(invoices.map((inv) => [inv.id, inv.number ?? inv.id.slice(0, 8)])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, counterpartyId, category, requiresCounterparty]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<CashTransaction>(`/organizations/${orgId}/cash-transactions`, {
        documentDate,
        cashboxId,
        direction,
        category,
        counterpartyId: requiresCounterparty ? counterpartyId : undefined,
        amount: Number(amount),
        description: description || undefined,
        sourceSalesInvoiceId: category === 'CUSTOMER_PAYMENT' && sourceInvoiceId ? sourceInvoiceId : undefined,
        sourcePurchaseInvoiceId: category === 'SUPPLIER_PAYMENT' && sourceInvoiceId ? sourceInvoiceId : undefined,
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setShowForm(false);
      setAmount('');
      setDescription('');
      setCounterpartyId('');
      setSourceInvoiceId('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('treasury.cash_transaction.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.cashTransactions}</h1>
        {hasPermission('treasury.cash_transaction.create') && orgId && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : `+ ${t.common.create}`}
          </button>
        )}
      </div>

      <div className="inline-form">
        <label>
          {t.common.organization}
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>
              {t.common.select}
            </option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
              </option>
            ))}
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
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                <label>
                  {t.treasury.cashbox}
                  <select required value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
                    <option value="" disabled>
                      {t.common.select}
                    </option>
                    {cashboxes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.treasury.direction}
                  <select value={direction} onChange={(e) => onDirectionChange(e.target.value as 'RECEIPT' | 'PAYMENT')}>
                    <option value="RECEIPT">{t.treasury.receipt}</option>
                    <option value="PAYMENT">{t.treasury.payment}</option>
                  </select>
                </label>
                <label>
                  {t.treasury.category}
                  <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                    {CATEGORIES_BY_DIRECTION[direction].map((c) => (
                      <option key={c} value={c}>
                        {t.treasury.categoryLabel[c]}
                      </option>
                    ))}
                  </select>
                </label>
                {requiresCounterparty && (
                  <label>
                    {category === 'CUSTOMER_PAYMENT' ? t.common.customer : t.common.supplier}
                    <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                      <option value="" disabled>
                        {t.common.select}
                      </option>
                      {eligibleCounterparties.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {requiresCounterparty && counterpartyId && (
                  <label>
                    {t.treasury.applyToInvoice}
                    <select
                      value={sourceInvoiceId}
                      onChange={(e) => {
                        setSourceInvoiceId(e.target.value);
                        const ob = openObligations.find((o) => o.sourceDocumentId === e.target.value);
                        if (ob) setAmount(ob.remainingAmount);
                      }}
                    >
                      <option value="">{t.treasury.unapplied}</option>
                      {openObligations.map((o) => (
                        <option key={o.sourceDocumentId} value={o.sourceDocumentId}>
                          {invoiceNumbers[o.sourceDocumentId] ?? o.sourceDocumentId.slice(0, 8)} — {o.remainingAmount}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t.common.amount}
                  <input type="number" step="any" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label>
                  {t.common.description}
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>
              <div className="inline-form">
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="panel-note">{t.treasury.noCashTransactions}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{t.treasury.cashbox}</th>
                  <th>{t.treasury.direction}</th>
                  <th>{t.treasury.category}</th>
                  <th>{t.common.amount}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.posting}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/cash-transactions/${r.id}`}>{r.number ?? r.id.slice(0, 8)}</Link>
                    </td>
                    <td>{r.documentDate.slice(0, 10)}</td>
                    <td>{cashboxes.find((c) => c.id === r.cashboxId)?.name ?? r.cashboxId.slice(0, 8)}</td>
                    <td>{r.direction === 'RECEIPT' ? t.treasury.receipt : t.treasury.payment}</td>
                    <td>{t.treasury.categoryLabel[r.category]}</td>
                    <td className="numeric">{r.amount}</td>
                    <td>
                      <StatusBadge kind="document" value={r.status} />
                    </td>
                    <td>
                      <StatusBadge kind="posting" value={r.postingStatus} />
                    </td>
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

export function CashTransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<CashTransaction | null>(null);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<CashTransaction>(`/organizations/${orgId}/cash-transactions/${id}`);
      setDoc(d);
      const [cbs, cps] = await Promise.all([
        api.get<Cashbox[]>(`/organizations/${orgId}/cashboxes`).catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
      ]);
      setCashboxes(cbs);
      setCounterparties(cps);
      if (hasPermission('audit.view')) setAuditEvents(await api.get<AuditEvent[]>(`/audit-events?entityType=CASH_TRANSACTION&entityId=${id}`).catch(() => []));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/CASH_TRANSACTION/${doc.id}/${command}`, { expectedVersion: doc.version });
      const labelByCmd = { post: t.common.posted, unpost: t.common.unposted, cancel: t.common.cancelled } as const;
      showSuccess(t.toast.documentAction(t.treasury.cashTransactionSingular, labelByCmd[command]));
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setEditAmount(doc.amount);
    setEditDescription(doc.description ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<CashTransaction>(`/organizations/${orgId}/cash-transactions/${doc.id}`, {
        expectedVersion: doc.version,
        amount: Number(editAmount),
        description: editDescription || undefined,
      });
      setDoc(updated);
      setEditing(false);
      showSuccess(t.common.save);
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
          <div className="badge-row">
            <StatusBadge kind="document" value={doc.status} />
            <StatusBadge kind="posting" value={doc.postingStatus} />
          </div>
        </div>
        <div className="actions">
          <Link to="/cash-transactions" className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('treasury.cash_transaction.edit') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && !editing && (
            <button disabled={busy} onClick={startEdit}>
              {t.common.edit}
            </button>
          )}
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && !editing && (
            <button className="primary" disabled={busy} onClick={() => runCommand('post')}>
              {t.common.post}
            </button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>
              {t.common.unpost}
            </button>
          )}
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        {editing ? (
          <div className="inline-form">
            <label>
              {t.common.amount}
              <input type="number" step="any" min="0" required value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </label>
            <label>
              {t.common.description}
              <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </label>
            <button className="primary" disabled={busy} onClick={saveEdit}>
              {busy ? t.common.saving : t.common.save}
            </button>
            <button disabled={busy} onClick={() => setEditing(false)}>
              {t.common.cancel}
            </button>
          </div>
        ) : (
          <dl className="kv-grid">
            <dt>{t.common.documentDate}</dt>
            <dd>{doc.documentDate.slice(0, 10)}</dd>
            <dt>{t.treasury.cashbox}</dt>
            <dd>{cashboxes.find((c) => c.id === doc.cashboxId)?.name ?? doc.cashboxId.slice(0, 8)}</dd>
            <dt>{t.treasury.direction}</dt>
            <dd>{doc.direction === 'RECEIPT' ? t.treasury.receipt : t.treasury.payment}</dd>
            <dt>{t.treasury.category}</dt>
            <dd>{t.treasury.categoryLabel[doc.category]}</dd>
            {doc.counterpartyId && (
              <>
                <dt>{t.common.customer}/{t.common.supplier}</dt>
                <dd>{counterparties.find((c) => c.id === doc.counterpartyId)?.name ?? doc.counterpartyId.slice(0, 8)}</dd>
              </>
            )}
            <dt>{t.common.amount}</dt>
            <dd className="numeric">{doc.amount}</dd>
            <dt>{t.common.description}</dt>
            <dd>{doc.description ?? '—'}</dd>
          </dl>
        )}
      </section>

      <AccountingEntriesPanel orgId={orgId} documentType="CASH_TRANSACTION" documentId={doc.id} />

      {hasPermission('audit.view') && (
        <section className="card">
          <h2>{t.common.auditTrail}</h2>
          {auditEvents.length === 0 ? (
            <p className="panel-note">{t.common.noAuditEvents}</p>
          ) : (
            <ul className="audit-list">
              {auditEvents.map((e) => (
                <li key={e.id}>
                  <span className="audit-event-type">{e.eventType}</span>
                  <span className="muted"> {new Date(e.timestamp).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
