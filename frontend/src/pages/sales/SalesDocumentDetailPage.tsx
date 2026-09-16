import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type {
  AuditEvent,
  DocumentLink,
  SalesCounterpartyRef,
  SalesLineDraft,
  SalesOrder,
  SalesProductRef,
  SalesUnitRef,
} from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import type { SalesKind } from './SalesDocumentListPage';
import { SalesLinesEditor, emptyLine, serializeLines } from './SalesLinesEditor';
import { ApprovalStepsPanel } from '../docs/ApprovalStepsPanel';
import { AccountingEntriesPanel } from '../docs/AccountingEntriesPanel';

const KIND_CONFIG = {
  order: {
    title: 'Sales order',
    basePath: 'sales-orders',
    listRoute: '/sales-orders',
    docType: 'SALES_ORDER',
    editPerm: 'sales_order.edit',
    createBasedOnTarget: 'SALES_INVOICE' as const,
  },
  invoice: {
    title: 'Sales invoice',
    basePath: 'sales-invoices',
    listRoute: '/sales-invoices',
    docType: 'SALES_INVOICE',
    editPerm: 'sales_invoice.edit',
    createBasedOnTarget: null,
  },
} as const;

/**
 * Phase 4 — header + lines + post/unpost/cancel + audit + links for a
 * sales order/invoice. Editing replaces lines wholesale (backend
 * delete + re-insert under a version guard); posted docs must be
 * unposted before editing.
 */
export function SalesDocumentDetailPage({ kind }: { kind: SalesKind }) {
  const cfg = KIND_CONFIG[kind];
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();

  const [doc, setDoc] = useState<SalesOrder | null>(null);
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editPriceIncludesTax, setEditPriceIncludesTax] = useState(false);
  const [editLines, setEditLines] = useState<SalesLineDraft[]>([]);
  const [replaceLines, setReplaceLines] = useState(false);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const [d, l] = await Promise.all([
        api.get<SalesOrder>(`/organizations/${orgId}/${cfg.basePath}/${id}`),
        api.get<DocumentLink[]>(`/document-links?documentType=${cfg.docType}&documentId=${id}`),
      ]);
      setDoc(d);
      setLinks(l);
      setEditDescription(d.description ?? '');
      setEditPriceIncludesTax(d.priceIncludesTax);
      if (hasPermission('audit.view')) {
        const audit = await api.get<AuditEvent[]>(`/audit-events?entityType=${cfg.docType}&entityId=${id}`);
        setAuditEvents(audit);
      }
      const [prods, uoms, cps] = await Promise.all([
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
      ]);
      setProducts(prods);
      setUnits(uoms);
      setCounterparties(cps);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="muted">Select an organization to view this document.</p>;
  if (!doc) return <p className="muted">Loading…</p>;

  const productName = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8);
  const unitCode = (uid: string) => units.find((u) => u.id === uid)?.code ?? uid.slice(0, 8);
  const cpName = (cid: string) => counterparties.find((c) => c.id === cid)?.name ?? cid.slice(0, 8);

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/${cfg.docType}/${doc.id}/${command}`, { expectedVersion: doc.version });
      showSuccess(`${cfg.title} ${command}ed`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    setEditLines(
      (doc.lines ?? []).map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity,
        price: l.price,
        taxRate: l.taxRate,
        description: l.description ?? '',
      })),
    );
    if ((doc.lines ?? []).length === 0) setEditLines([emptyLine()]);
    setReplaceLines(false);
    setEditing(true);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch<SalesOrder>(`/organizations/${orgId}/${cfg.basePath}/${doc.id}`, {
        description: editDescription || undefined,
        priceIncludesTax: editPriceIncludesTax,
        ...(replaceLines ? { lines: serializeLines(editLines) } : {}),
        expectedVersion: doc.version,
      });
      showSuccess(`${cfg.title} updated`);
      setEditing(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createBasedOn = async () => {
    const targetType = cfg.createBasedOnTarget;
    if (!targetType) return;
    setBusy(true);
    try {
      const target = await api.post<SalesOrder>(
        `/documents/${cfg.docType}/${doc.id}/create-based-on/${targetType}`,
        {},
      );
      showSuccess('Invoice draft created from order');
      navigate(`/sales-invoices/${target.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const canEdit = hasPermission(cfg.editPerm) && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED';
  const isOrder = kind === 'order';
  const approvalBlocksPost = isOrder && doc.approvalStatus !== 'APPROVED' && doc.approvalStatus !== 'NOT_REQUIRED' && !!doc.approvalStatus;

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{doc.number ?? doc.id}</h1>
          <div className="badge-row">
            <StatusBadge kind="document" value={doc.status} />
            <StatusBadge kind="posting" value={doc.postingStatus} />
            {isOrder && doc.approvalStatus && <StatusBadge kind="approval" value={doc.approvalStatus} />}
          </div>
        </div>
        <div className="actions">
          <Link to={cfg.listRoute} className="link-muted">
            ← Back to list
          </Link>
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && !approvalBlocksPost && (
            <button disabled={busy} onClick={() => runCommand('post')}>
              Post
            </button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>
              Unpost
            </button>
          )}
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>
              Cancel
            </button>
          )}
          {cfg.createBasedOnTarget && hasPermission('sales_invoice.create') && (
            <button disabled={busy} onClick={createBasedOn}>
              Create invoice…
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>Header</h2>
        <dl className="kv-grid">
          <dt>Customer</dt>
          <dd>{cpName(doc.counterpartyId)}</dd>
          <dt>Document date</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>Posted at</dt>
          <dd>{doc.postedAt ?? '—'}</dd>
          <dt>Subtotal</dt>
          <dd className="numeric">{doc.subtotal}</dd>
          <dt>Tax total</dt>
          <dd className="numeric">{doc.taxTotal}</dd>
          <dt>Grand total</dt>
          <dd className="numeric">{doc.grandTotal}</dd>
          <dt>Prices include tax</dt>
          <dd>{doc.priceIncludesTax ? 'Yes' : 'No'}</dd>
          <dt>Description</dt>
          <dd>{doc.description ?? '—'}</dd>
          {isOrder && (
            <>
              <dt>Credit status</dt>
              <dd>{doc.creditStatus ?? '—'}</dd>
              <dt>Reservation status</dt>
              <dd>{doc.reservationStatus ?? '—'}</dd>
            </>
          )}
          <dt>Version</dt>
          <dd>{doc.version}</dd>
        </dl>

        {canEdit && (
          <>
            {!editing ? (
              <button onClick={startEditing}>Edit</button>
            ) : (
              <form onSubmit={saveEdit}>
                <div className="inline-form">
                  <label>
                    Description
                    <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={editPriceIncludesTax}
                      onChange={(e) => setEditPriceIncludesTax(e.target.checked)}
                    />
                    Prices include tax
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={replaceLines} onChange={(e) => setReplaceLines(e.target.checked)} />
                    Replace lines
                  </label>
                </div>
                {replaceLines && (
                  <SalesLinesEditor lines={editLines} setLines={setEditLines} products={products} units={units} />
                )}
                <div className="inline-form">
                  <button type="submit" disabled={busy}>
                    Save
                  </button>
                  <button type="button" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Lines</h2>
        {(doc.lines ?? []).length === 0 ? (
          <p className="muted">No lines yet — edit to add lines before posting.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Tax %</th>
                <th>Line total</th>
                <th>Tax</th>
                <th>Total w/ tax</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines!.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>{productName(l.productId)}</td>
                  <td>{unitCode(l.unitId)}</td>
                  <td className="numeric">{l.quantity}</td>
                  <td className="numeric">{l.price}</td>
                  <td className="numeric">{l.taxRate}</td>
                  <td className="numeric">{l.lineTotal}</td>
                  <td className="numeric">{l.taxAmount}</td>
                  <td className="numeric">{l.lineTotalWithTax}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isOrder && orgId && (
        <ApprovalStepsPanel
          orgId={orgId}
          documentType={cfg.docType}
          documentId={doc.id}
          approvalStatus={doc.approvalStatus}
          approvePerm="sales.order.approve"
          rejectPerm="sales.order.reject"
          approveEndpoint={`${cfg.basePath}/${doc.id}/approve`}
          rejectEndpoint={`${cfg.basePath}/${doc.id}/reject`}
          onChanged={load}
        />
      )}

      {orgId && <AccountingEntriesPanel orgId={orgId} documentType={cfg.docType} documentId={doc.id} />}

      <section className="card">
        <h2>Document links</h2>
        {links.length === 0 ? (
          <p className="muted">No related documents.</p>
        ) : (
          <ul className="link-list">
            {links.map((l) => {
              const isSource = l.sourceDocumentId === doc.id;
              const otherType = isSource ? l.targetDocumentType : l.sourceDocumentType;
              const otherId = isSource ? l.targetDocumentId : l.sourceDocumentId;
              const otherRoute =
                otherType === 'SALES_ORDER'
                  ? `/sales-orders/${otherId}`
                  : otherType === 'SALES_INVOICE'
                    ? `/sales-invoices/${otherId}`
                    : `/documents/${otherId}`;
              return (
                <li key={l.id}>
                  <span className="relation-type">{l.relationType}</span> {isSource ? '→' : '←'}{' '}
                  <Link to={otherRoute}>
                    {otherType} · {otherId.slice(0, 8)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {hasPermission('audit.view') && (
        <section className="card">
          <h2>Audit trail</h2>
          {auditEvents.length === 0 ? (
            <p className="muted">No audit events.</p>
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
