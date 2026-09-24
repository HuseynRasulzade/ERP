import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { ApprovalStepsPanel } from '../docs/ApprovalStepsPanel';
import { AccountingEntriesPanel } from '../docs/AccountingEntriesPanel';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface PaymentOrder {
  id: string;
  number: string | null;
  documentDate: string;
  status: string;
  postingStatus: string;
  approvalStatus: string;
  paymentRequestId: string;
  counterpartyId: string;
  bankAccountId: string;
  amount: string;
  bankReference: string | null;
  bankPaymentStatus: string;
  reconciled: boolean;
  reconciledAt: string | null;
  bankStatementAmount: string | null;
  reconciliationDifference: string | null;
  version: number;
}

export function PaymentOrderListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    try {
      setItems(await api.get<PaymentOrder[]>(`/organizations/${orgId}/payment-orders`));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('treasury.payment_order.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.paymentOrders}</h1>
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
      ) : loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="panel-note">{t.treasury.noPaymentOrders}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.common.number}</th>
              <th>{t.common.date}</th>
              <th>{t.common.amount}</th>
              <th>{t.common.status}</th>
              <th>{t.common.posting}</th>
              <th>{t.common.approvalStatus}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/payment-orders/${o.id}`}>{o.number ?? o.id.slice(0, 8)}</Link></td>
                <td>{o.documentDate.slice(0, 10)}</td>
                <td className="numeric">{o.amount}</td>
                <td><StatusBadge kind="document" value={o.status} /></td>
                <td><StatusBadge kind="posting" value={o.postingStatus} /></td>
                <td><StatusBadge kind="approval" value={o.approvalStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface PurchaseInvoiceRef {
  id: string;
  number: string | null;
  counterpartyId: string;
  postingStatus: string;
  amountDue: string;
}

interface PaymentAllocationRow {
  id: string;
  paymentOrderId: string;
  purchaseInvoiceId: string | null;
  amount: string;
}

export function PaymentOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<PaymentOrder | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [bankStatementAmount, setBankStatementAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [invoices, setInvoices] = useState<PurchaseInvoiceRef[]>([]);
  const [allocLines, setAllocLines] = useState<{ purchaseInvoiceId: string; amount: string }[]>([]);
  const [allocBusy, setAllocBusy] = useState(false);
  const [advances, setAdvances] = useState<(PaymentAllocationRow & { paymentOrder: { number: string | null; documentDate: string } })[]>([]);
  const [applyTargets, setApplyTargets] = useState<Record<string, { purchaseInvoiceId: string; amount: string }>>({});
  const [applyBusy, setApplyBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<PaymentOrder>(`/organizations/${orgId}/payment-orders/${id}`);
      setDoc(d);
      setBankReference(d.bankReference ?? '');
      if (hasPermission('audit.view')) setAuditEvents(await api.get<AuditEvent[]>(`/audit-events?entityType=PAYMENT_ORDER&entityId=${id}`).catch(() => []));
      const [invs, allocs] = await Promise.all([
        api.get<PurchaseInvoiceRef[]>(`/organizations/${orgId}/purchase-invoices`).catch(() => []),
        api.get<PaymentAllocationRow[]>(`/organizations/${orgId}/payment-orders/${id}/allocations`).catch(() => []),
      ]);
      setInvoices(invs.filter((i) => i.counterpartyId === d.counterpartyId && i.postingStatus === 'POSTED'));
      setAllocLines(
        allocs.length > 0
          ? allocs.map((a) => ({ purchaseInvoiceId: a.purchaseInvoiceId ?? '', amount: a.amount }))
          : [{ purchaseInvoiceId: '', amount: d.amount }],
      );
      if (d.postingStatus === 'POSTED') {
        const adv = await api
          .get<(PaymentAllocationRow & { paymentOrder: { number: string | null; documentDate: string } })[]>(
            `/organizations/${orgId}/payment-orders/unmatched-advances?counterpartyId=${d.counterpartyId}`,
          )
          .catch(() => []);
        setAdvances(adv);
      }
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => { load(); }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/PAYMENT_ORDER/${doc.id}/${command}`, { expectedVersion: doc.version });
      const labelByCmd = { post: t.common.posted, unpost: t.common.unposted, cancel: t.common.cancelled } as const;
      showSuccess(t.toast.documentAction(t.treasury.paymentOrderSingular, labelByCmd[command]));
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const printOrder = async () => {
    if (!doc || !orgId) return;
    try {
      const blob = await api.downloadBlob(`/organizations/${orgId}/payment-orders/${doc.id}/print`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      showError(err);
    }
  };

  const addAllocLine = () => setAllocLines((lines) => [...lines, { purchaseInvoiceId: '', amount: '' }]);
  const removeAllocLine = (idx: number) => setAllocLines((lines) => lines.filter((_, i) => i !== idx));
  const updateAllocLine = (idx: number, patch: Partial<{ purchaseInvoiceId: string; amount: string }>) =>
    setAllocLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const saveAllocations = async () => {
    if (!doc) return;
    setAllocBusy(true);
    try {
      const allocations = allocLines
        .filter((l) => l.amount !== '')
        .map((l) => ({ purchaseInvoiceId: l.purchaseInvoiceId || undefined, amount: Number(l.amount) }));
      await api.put(`/organizations/${orgId}/payment-orders/${doc.id}/allocations`, { allocations });
      showSuccess('Allocation saved');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setAllocBusy(false);
    }
  };

  const allocTotal = allocLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const applyAdvance = async (allocationId: string) => {
    const target = applyTargets[allocationId];
    if (!target?.purchaseInvoiceId || !target.amount) return;
    setApplyBusy(true);
    try {
      await api.post(`/organizations/${orgId}/payment-orders/allocations/${allocationId}/apply`, {
        purchaseInvoiceId: target.purchaseInvoiceId,
        amount: Number(target.amount),
      });
      showSuccess('Advance applied');
      setApplyTargets((t) => ({ ...t, [allocationId]: { purchaseInvoiceId: '', amount: '' } }));
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setApplyBusy(false);
    }
  };

  const reconcile = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/payment-orders/${doc.id}/reconcile`, {
        expectedVersion: doc.version, bankStatementAmount: Number(bankStatementAmount), bankReference: bankReference || undefined,
      });
      showSuccess(t.treasury.reconciled);
      setBankStatementAmount('');
      await load();
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
            <StatusBadge kind="approval" value={doc.approvalStatus} />
          </div>
        </div>
        <div className="actions">
          <Link to="/payment-orders" className="link-muted">{t.common.backToList}</Link>
          <button disabled={busy} onClick={printOrder}>Print</button>
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && (doc.approvalStatus === 'APPROVED' || doc.approvalStatus === 'NOT_REQUIRED') && (
            <button className="primary" disabled={busy} onClick={() => runCommand('post')}>{t.common.post}</button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>{t.common.unpost}</button>
          )}
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>{t.common.cancel}</button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{t.common.documentDate}</dt><dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>{t.common.amount}</dt><dd className="numeric">{doc.amount}</dd>
          <dt>{t.treasury.sourceRequest}</dt><dd><Link to={`/payment-requests/${doc.paymentRequestId}`}>{doc.paymentRequestId.slice(0, 8)}</Link></dd>
          <dt>{t.treasury.bankPaymentStatus}</dt><dd>{doc.bankPaymentStatus}</dd>
          <dt>{t.treasury.bankReference}</dt><dd>{doc.bankReference ?? '—'}</dd>
        </dl>
      </section>

      <ApprovalStepsPanel
        orgId={orgId}
        documentType="PAYMENT_ORDER"
        documentId={doc.id}
        approvalStatus={doc.approvalStatus}
        approvePerm="treasury.payment_order.approve"
        rejectPerm="treasury.payment_order.reject"
        approveEndpoint={`payment-orders/${doc.id}/approve`}
        rejectEndpoint={`payment-orders/${doc.id}/reject`}
        onChanged={load}
      />

      <AccountingEntriesPanel orgId={orgId} documentType="PAYMENT_ORDER" documentId={doc.id} />

      {hasPermission('treasury.payment_order.edit') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && (
        <section className="card">
          <h2>Payment allocation</h2>
          <p className="panel-note">
            Split this payment across several open purchase invoices for the counterparty, or leave the invoice blank to record an unmatched advance. Lines must sum to the order&apos;s amount ({doc.amount}).
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Purchase invoice</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {allocLines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={line.purchaseInvoiceId} onChange={(e) => updateAllocLine(idx, { purchaseInvoiceId: e.target.value })}>
                      <option value="">Unmatched advance</option>
                      {invoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.number ?? inv.id.slice(0, 8)} (due {inv.amountDue})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" step="any" value={line.amount} onChange={(e) => updateAllocLine(idx, { amount: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="small" onClick={() => removeAllocLine(idx)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inline-form">
            <button type="button" onClick={addAllocLine}>+ Add line</button>
            <span className="muted">Total: {allocTotal.toFixed(2)} / {doc.amount}</span>
            <button className="primary" disabled={allocBusy} onClick={saveAllocations}>{allocBusy ? t.common.saving : t.common.save}</button>
          </div>
        </section>
      )}

      {hasPermission('treasury.payment_order.edit') && doc.postingStatus === 'POSTED' && advances.length > 0 && (
        <section className="card">
          <h2>Unmatched advances for this counterparty</h2>
          <p className="panel-note">Apply part or all of a previous advance to an open invoice.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>From payment order</th>
                <th>Remaining advance</th>
                <th>Apply to invoice</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {advances.map((a) => {
                const target = applyTargets[a.id] ?? { purchaseInvoiceId: '', amount: '' };
                const eligibleInvoices = invoices.filter((i) => i.id !== doc.id);
                return (
                  <tr key={a.id}>
                    <td>{a.paymentOrder.number ?? a.paymentOrderId.slice(0, 8)}</td>
                    <td className="numeric">{a.amount}</td>
                    <td>
                      <select value={target.purchaseInvoiceId} onChange={(e) => setApplyTargets((t) => ({ ...t, [a.id]: { ...target, purchaseInvoiceId: e.target.value } }))}>
                        <option value="">Select invoice…</option>
                        {eligibleInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>{inv.number ?? inv.id.slice(0, 8)} (due {inv.amountDue})</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" step="any" value={target.amount} onChange={(e) => setApplyTargets((t) => ({ ...t, [a.id]: { ...target, amount: e.target.value } }))} />
                    </td>
                    <td>
                      <button type="button" disabled={applyBusy || !target.purchaseInvoiceId || !target.amount} onClick={() => applyAdvance(a.id)}>Apply</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {hasPermission('treasury.payment_order.reconcile') && doc.postingStatus === 'POSTED' && (
        <section className="card">
          <h2>{t.treasury.reconciliation}</h2>
          {doc.reconciled ? (
            <dl className="kv-grid">
              <dt>{t.treasury.bankStatementAmount}</dt><dd className="numeric">{doc.bankStatementAmount}</dd>
              <dt>{t.treasury.reconciliationDifference}</dt><dd className="numeric">{doc.reconciliationDifference}</dd>
              <dt>{t.common.date}</dt><dd>{doc.reconciledAt?.slice(0, 10) ?? '—'}</dd>
            </dl>
          ) : (
            <div className="inline-form">
              <label>{t.treasury.bankStatementAmount}<input type="number" step="any" value={bankStatementAmount} onChange={(e) => setBankStatementAmount(e.target.value)} /></label>
              <label>{t.treasury.bankReference}<input value={bankReference} onChange={(e) => setBankReference(e.target.value)} /></label>
              <button className="primary" disabled={busy || !bankStatementAmount} onClick={reconcile}>{t.treasury.reconcile}</button>
            </div>
          )}
        </section>
      )}

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
