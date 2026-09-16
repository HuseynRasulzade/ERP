import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent, BizDoc, SalesCounterpartyRef, SalesProductRef, SalesUnitRef } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { ApprovalStepsPanel } from '../docs/ApprovalStepsPanel';

const LINE_TYPES = ['INVENTORY', 'SERVICE', 'EXPENSE', 'FIXED_ASSET', 'PREPAYMENT', 'OTHER'];

interface PILineDraft {
  lineType: string;
  productId: string;
  unitId: string;
  quantity: string;
  price: string;
  goodsReceiptLineId: string;
  supplierOrderLineId: string;
}

function emptyLine(): PILineDraft {
  return { lineType: 'INVENTORY', productId: '', unitId: '', quantity: '1', price: '', goodsReceiptLineId: '', supplierOrderLineId: '' };
}

export function PurchaseInvoiceListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [documents, setDocuments] = useState<BizDoc[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [lines, setLines] = useState<PILineDraft[]>([emptyLine()]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const [docs, cps, prods, uoms] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/purchase-invoices`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setDocuments(docs);
      setCounterparties(cps.filter((c) => c.counterpartyType === 'SUPPLIER' || c.counterpartyType === 'BOTH'));
      setProducts(prods);
      setUnits(uoms);
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

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<BizDoc>(`/organizations/${orgId}/purchase-invoices`, {
        counterpartyId,
        documentDate,
        dueDate: dueDate || undefined,
        supplierInvoiceNumber: supplierInvoiceNumber || undefined,
        lines: lines.map((l) => ({
          lineType: l.lineType,
          productId: l.productId || undefined,
          unitId: l.unitId || undefined,
          quantity: Number(l.quantity),
          price: Number(l.price),
          goodsReceiptLineId: l.goodsReceiptLineId || undefined,
          supplierOrderLineId: l.supplierOrderLineId || undefined,
        })),
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setSupplierInvoiceNumber('');
      setDueDate('');
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('purchase_execution.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.purchaseInvoices}</h1>
        {hasPermission('purchase_execution.create') && orgId && (
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
              <p className="panel-note">Tip: normally create this via "Create invoice…" on a Supplier Order or Goods Receipt — it fills lines and links automatically.</p>
              <div className="inline-form">
                <label>
                  {t.common.supplier}
                  <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="" disabled>
                      {t.common.select}
                    </option>
                    {counterparties.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                <label>
                  {t.common.dueDate}
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
                <label>
                  Supplier invoice #
                  <input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} />
                </label>
              </div>
              {lines.map((line, i) => (
                <div className="inline-form" key={i}>
                  <label>
                    Line type
                    <select value={line.lineType} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, lineType: e.target.value } : l)))}>
                      {LINE_TYPES.map((lt) => (
                        <option key={lt} value={lt}>
                          {lt}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(line.lineType === 'INVENTORY' || line.lineType === 'SERVICE') && (
                    <>
                      <label>
                        {t.common.product}
                        <select required value={line.productId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, productId: e.target.value } : l)))}>
                          <option value="" disabled>
                            {t.common.select}
                          </option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code} — {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t.common.unit}
                        <select required value={line.unitId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, unitId: e.target.value } : l)))}>
                          <option value="" disabled>
                            {t.common.select}
                          </option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.code}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label>
                    {t.common.quantity}
                    <input type="number" step="any" min="0" required value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                  </label>
                  <label>
                    {t.common.price}
                    <input type="number" step="any" min="0" required value={line.price} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, price: e.target.value } : l)))} />
                  </label>
                  <label>
                    Goods receipt line id
                    <input value={line.goodsReceiptLineId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, goodsReceiptLineId: e.target.value } : l)))} placeholder="optional" />
                  </label>
                  <label>
                    Supplier order line id
                    <input value={line.supplierOrderLineId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, supplierOrderLineId: e.target.value } : l)))} placeholder="optional" />
                  </label>
                  <button type="button" className="small" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    {t.common.remove}
                  </button>
                </div>
              ))}
              <div className="inline-form">
                <button type="button" className="small" onClick={() => setLines([...lines, emptyLine()])}>
                  {t.common.addLine}
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : documents.length === 0 ? (
            <p className="panel-note">No purchase invoices yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{t.common.supplier}</th>
                  <th>{t.common.grandTotal}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.posting}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/purchase-invoices/${d.id}`}>{d.number ?? d.id.slice(0, 8)}</Link>
                    </td>
                    <td>{d.documentDate.slice(0, 10)}</td>
                    <td>{counterparties.find((c) => c.id === d.counterpartyId)?.name ?? '—'}</td>
                    <td className="numeric">{d.grandTotal ?? '—'}</td>
                    <td>
                      <StatusBadge kind="document" value={d.status} />
                    </td>
                    <td>
                      <StatusBadge kind="posting" value={d.postingStatus} />
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

interface MatchingResult {
  overallStatus: string;
  lines: { productId: string | null; orderedQty: string | null; orderPrice: string | null; receivedQty: string | null; invoicedQty: string; invoicePrice: string; status: string }[];
}

interface SupplierPayable {
  invoiceAmount: string;
  paidAmount: string;
  remainingAmount: string;
  dueDate: string | null;
  status: string;
}

export function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [matching, setMatching] = useState<MatchingResult | null>(null);
  const [payable, setPayable] = useState<SupplierPayable | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<BizDoc>(`/organizations/${orgId}/purchase-invoices/${id}`);
      setDoc(d);
      if (hasPermission('audit.view')) setAuditEvents(await api.get<AuditEvent[]>(`/audit-events?entityType=PURCHASE_INVOICE&entityId=${id}`).catch(() => []));
      const [prods, uoms, cps, m, payables] = await Promise.all([
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<MatchingResult>(`/organizations/${orgId}/purchase-invoices/${id}/matching`).catch(() => null),
        api.get<SupplierPayable[]>(`/organizations/${orgId}/supplier-payables`).catch(() => []),
      ]);
      setProducts(prods);
      setUnits(uoms);
      setCounterparties(cps);
      setMatching(m);
      setPayable((payables as any).find((p: any) => p.sourceDocumentId === id) ?? null);
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

  const productName = (pid?: string) => (pid ? (products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)) : '—');
  const unitCode = (uid?: string) => (uid ? (units.find((u) => u.id === uid)?.code ?? uid.slice(0, 8)) : '—');
  const cpName = (cid?: string) => (cid ? (counterparties.find((c) => c.id === cid)?.name ?? `${cid.slice(0, 8)}…`) : '—');

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/PURCHASE_INVOICE/${doc.id}/${command}`, { expectedVersion: doc.version });
      showSuccess(`Invoice ${command}ed`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const checkMatching = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/purchase-invoices/${doc.id}/check-matching`, {});
      showSuccess('Matching checked and recorded');
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
            {doc.approvalStatus && <StatusBadge kind="approval" value={doc.approvalStatus} />}
            {matching && <span className={`badge badge-generic-${matching.overallStatus === 'MATCHED' ? 'ok' : 'warn'}`}>{matching.overallStatus}</span>}
          </div>
        </div>
        <div className="actions">
          <Link to="/purchase-invoices" className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && (doc.approvalStatus === 'APPROVED' || doc.approvalStatus === 'NOT_REQUIRED' || !doc.approvalStatus) && (
            <button className="primary" disabled={busy} onClick={() => runCommand('post')}>
              {t.common.post}
            </button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>
              {t.common.unpost}
            </button>
          )}
          <button disabled={busy} onClick={checkMatching}>
            Check matching
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const created = await api.post<BizDoc>(`/documents/PURCHASE_INVOICE/${doc.id}/create-based-on/PURCHASE_RETURN`, {});
                navigate(`/purchase-returns/${created.id}`);
              } catch (err) {
                showError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create return…
          </button>
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{t.common.supplier}</dt>
          <dd>{cpName(doc.counterpartyId)}</dd>
          <dt>{t.common.documentDate}</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>{t.common.dueDate}</dt>
          <dd>{(doc.dueDate as string | undefined)?.slice(0, 10) ?? '—'}</dd>
          <dt>Supplier invoice #</dt>
          <dd>{String(doc.supplierInvoiceNumber ?? '—')}</dd>
          <dt>{t.common.subtotal}</dt>
          <dd className="numeric">{doc.subtotal ?? '—'}</dd>
          <dt>{t.common.taxTotal}</dt>
          <dd className="numeric">{doc.taxTotal ?? '—'}</dd>
          <dt>{t.common.grandTotal}</dt>
          <dd className="numeric">{doc.grandTotal ?? '—'}</dd>
        </dl>
      </section>

      {payable && (
        <section className="card">
          <h2>Supplier payable</h2>
          <dl className="kv-grid">
            <dt>{t.common.amount}</dt>
            <dd className="numeric">{payable.invoiceAmount}</dd>
            <dt>Paid</dt>
            <dd className="numeric">{payable.paidAmount}</dd>
            <dt>Remaining</dt>
            <dd className="numeric">{payable.remainingAmount}</dd>
            <dt>{t.common.dueDate}</dt>
            <dd>{payable.dueDate ?? '—'}</dd>
            <dt>{t.common.status}</dt>
            <dd>
              <span className={`badge badge-generic-${payable.status === 'OVERDUE' ? 'bad' : payable.status === 'OPEN' ? 'neutral' : 'ok'}`}>{payable.status}</span>
            </dd>
          </dl>
        </section>
      )}

      <section className="card">
        <h2>{t.common.lines}</h2>
        {(doc.lines ?? []).length === 0 ? (
          <p className="panel-note">{t.common.noLinesYet}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>{t.common.product}</th>
                <th>{t.common.unit}</th>
                <th>{t.common.quantity}</th>
                <th>{t.common.price}</th>
                <th>{t.common.lineTotal}</th>
                <th>{t.common.tax}</th>
                <th>{t.common.totalWithTax}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines!.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td>{i + 1}</td>
                  <td className="mono">{l.lineType}</td>
                  <td>{productName(l.productId)}</td>
                  <td>{unitCode(l.unitId)}</td>
                  <td className="numeric">{l.quantity}</td>
                  <td className="numeric">{l.price}</td>
                  <td className="numeric">{l.lineTotal}</td>
                  <td className="numeric">{l.taxAmount}</td>
                  <td className="numeric">{l.lineTotalWithTax}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {orgId && (
        <ApprovalStepsPanel
          orgId={orgId}
          documentType="PURCHASE_INVOICE"
          documentId={doc.id}
          approvalStatus={doc.approvalStatus}
          approvePerm="purchase_execution.invoice.approve"
          rejectPerm="purchase_execution.invoice.reject"
          approveEndpoint={`purchase-invoices/${doc.id}/approve`}
          rejectEndpoint={`purchase-invoices/${doc.id}/reject`}
          onChanged={load}
        />
      )}

      {matching && (
        <section className="card">
          <h2>Three-way matching</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.product}</th>
                <th>Ordered</th>
                <th>Order price</th>
                <th>Received</th>
                <th>Invoiced</th>
                <th>Invoice price</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {matching.lines.map((l, i) => (
                <tr key={i}>
                  <td>{productName(l.productId ?? undefined)}</td>
                  <td className="numeric">{l.orderedQty ?? '—'}</td>
                  <td className="numeric">{l.orderPrice ?? '—'}</td>
                  <td className="numeric">{l.receivedQty ?? '—'}</td>
                  <td className="numeric">{l.invoicedQty}</td>
                  <td className="numeric">{l.invoicePrice}</td>
                  <td>
                    <span className={`badge badge-generic-${l.status === 'MATCHED' ? 'ok' : 'warn'}`}>{l.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
