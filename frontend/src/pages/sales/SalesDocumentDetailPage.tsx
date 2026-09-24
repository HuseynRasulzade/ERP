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
  Warehouse,
} from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import type { SalesKind } from './SalesDocumentListPage';
import { SalesLinesEditor, emptyLine, serializeLines } from './SalesLinesEditor';
import { ApprovalStepsPanel } from '../docs/ApprovalStepsPanel';
import { AccountingEntriesPanel } from '../docs/AccountingEntriesPanel';
import { CreateContractFromSOPanel } from '../counterparties/CreateContractFromSOPanel';
import type { BizDoc } from '../../api/types';
import { HoldsPanel } from '../docs/HoldsPanel';
import { CreditCheckPanel, FulfillmentPanel, ReservationsPanel, ShipmentPlansPanel, PaymentSchedulePanel, SupplyPegPanel } from './SalesOrderManagementPanels';

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
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [editExternalReference, setEditExternalReference] = useState('');
  const [editRequestedDeliveryDate, setEditRequestedDeliveryDate] = useState('');
  const [editPromisedDeliveryDate, setEditPromisedDeliveryDate] = useState('');
  const [editSalesChannel, setEditSalesChannel] = useState('');
  const [editTaxPointDate, setEditTaxPointDate] = useState('');
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
      setEditWarehouseId(d.warehouseId ?? '');
      setEditExternalReference(d.externalReference ?? '');
      setEditRequestedDeliveryDate(d.requestedDeliveryDate?.slice(0, 10) ?? '');
      setEditPromisedDeliveryDate(d.promisedDeliveryDate?.slice(0, 10) ?? '');
      setEditSalesChannel(d.salesChannel ?? '');
      setEditTaxPointDate(d.taxPointDate?.slice(0, 10) ?? '');
      if (hasPermission('audit.view')) {
        const audit = await api.get<AuditEvent[]>(`/audit-events?entityType=${cfg.docType}&entityId=${id}`);
        setAuditEvents(audit);
      }
      const [prods, uoms, cps, whs] = await Promise.all([
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      ]);
      setProducts(prods);
      setUnits(uoms);
      setCounterparties(cps);
      setWarehouses(whs);
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
      // Sales Order has its own confirm/reopen endpoints (spec section 22)
      // gated by sales.order.confirm/reopen rather than the generic
      // documents.post/unpost — using them here means a user who only
      // holds the order-specific permission can still confirm/reopen.
      const isOrderKind = kind === 'order';
      const path = isOrderKind && command === 'post'
        ? `/organizations/${orgId}/${cfg.basePath}/${doc.id}/confirm`
        : isOrderKind && command === 'unpost'
          ? `/organizations/${orgId}/${cfg.basePath}/${doc.id}/reopen`
          : `/documents/${cfg.docType}/${doc.id}/${command}`;
      await api.post(path, { expectedVersion: doc.version });
      showSuccess(`${cfg.title} ${command}ed`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    // create-based-on mappers (SalesOrderToSalesInvoiceMapper,
    // ShipmentToSalesInvoiceMapper, etc.) now copy lines forward
    // themselves, so a freshly created document already has them — no
    // frontend prefill workaround needed here any more.
    const currentLines = (doc.lines ?? []).map((l) => ({
      productId: l.productId,
      unitId: l.unitId,
      quantity: l.quantity,
      price: l.price,
      taxRate: l.taxRate,
      description: l.description ?? '',
    }));
    setEditLines(currentLines.length > 0 ? currentLines : [emptyLine()]);
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
        ...(isOrder
          ? {
              warehouseId: editWarehouseId || undefined,
              externalReference: editExternalReference || undefined,
              requestedDeliveryDate: editRequestedDeliveryDate || undefined,
              promisedDeliveryDate: editPromisedDeliveryDate || undefined,
              salesChannel: editSalesChannel || undefined,
            }
          : { taxPointDate: editTaxPointDate || undefined }),
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

  const printDocument = async () => {
    if (!orgId) return;
    try {
      const blob = await api.downloadBlob(`/organizations/${orgId}/${cfg.basePath}/${doc.id}/print`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      showError(err);
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
          <button disabled={busy} onClick={printDocument}>
            Print
          </button>
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
          {isOrder ? (
            <>
              <dt>Warehouse</dt>
              <dd>{warehouses.find((w) => w.id === doc.warehouseId)?.name ?? '—'}</dd>
              <dt>Credit status</dt>
              <dd>{doc.creditStatus ?? '—'}</dd>
              <dt>Reservation status</dt>
              <dd>{doc.reservationStatus ?? '—'}</dd>
              <dt>Fulfillment status</dt>
              <dd>{doc.fulfillmentStatus ?? '—'}</dd>
              <dt>External reference</dt>
              <dd>{doc.externalReference ?? '—'}</dd>
              <dt>Sales channel</dt>
              <dd>{doc.salesChannel ?? '—'}</dd>
              <dt>Requested delivery date</dt>
              <dd>{doc.requestedDeliveryDate?.slice(0, 10) ?? '—'}</dd>
              <dt>Promised delivery date</dt>
              <dd>{doc.promisedDeliveryDate?.slice(0, 10) ?? '—'}</dd>
            </>
          ) : (
            <>
              <dt>Tax point date</dt>
              <dd>{doc.taxPointDate?.slice(0, 10) ?? '—'}</dd>
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
                  {isOrder ? (
                    <>
                      <label>
                        Warehouse
                        <select value={editWarehouseId} onChange={(e) => setEditWarehouseId(e.target.value)}>
                          <option value="">—</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>External reference<input value={editExternalReference} onChange={(e) => setEditExternalReference(e.target.value)} /></label>
                      <label>Sales channel<input value={editSalesChannel} onChange={(e) => setEditSalesChannel(e.target.value)} /></label>
                      <label>Requested delivery date<input type="date" value={editRequestedDeliveryDate} onChange={(e) => setEditRequestedDeliveryDate(e.target.value)} /></label>
                      <label>Promised delivery date<input type="date" value={editPromisedDeliveryDate} onChange={(e) => setEditPromisedDeliveryDate(e.target.value)} /></label>
                    </>
                  ) : (
                    <label>Tax point date<input type="date" value={editTaxPointDate} onChange={(e) => setEditTaxPointDate(e.target.value)} /></label>
                  )}
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

      {isOrder && orgId && (
        <>
          <HoldsPanel
            docBasePath={cfg.basePath}
            docId={doc.id}
            releaseBasePath="order-holds"
            holdTypes={['CREDIT', 'CUSTOMER_REQUEST', 'STOCK', 'MANUAL', 'APPROVAL']}
            permission="sales.order_hold.manage"
          />
          <CreditCheckPanel orgId={orgId} doc={doc} />
          <FulfillmentPanel orgId={orgId} doc={doc} productName={productName} />
          <ReservationsPanel orgId={orgId} doc={doc} warehouses={warehouses} productName={productName} />
          <ShipmentPlansPanel orgId={orgId} doc={doc} warehouses={warehouses} productName={productName} />
          <PaymentSchedulePanel orgId={orgId} doc={doc} />
          <SupplyPegPanel orgId={orgId} doc={doc} productName={productName} />
        </>
      )}

      {orgId && <AccountingEntriesPanel orgId={orgId} documentType={cfg.docType} documentId={doc.id} />}

      {isOrder && orgId && <CreateContractFromSOPanel orgId={orgId} doc={doc as unknown as BizDoc} />}

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
