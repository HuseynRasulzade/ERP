import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { ApprovalStepsPanel } from '../docs/ApprovalStepsPanel';
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
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<PaymentOrder>(`/organizations/${orgId}/payment-orders/${id}`);
      setDoc(d);
      setBankReference(d.bankReference ?? '');
      if (hasPermission('audit.view')) setAuditEvents(await api.get<AuditEvent[]>(`/audit-events?entityType=PAYMENT_ORDER&entityId=${id}`).catch(() => []));
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
