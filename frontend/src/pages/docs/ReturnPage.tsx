import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent, BizDoc, SalesCounterpartyRef, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

export interface ReturnKind {
  title: string;
  basePath: string;
  routePrefix: string;
  docType: string;
  viewPerm: string;
  createPerm: string;
  counterpartyLabel: string;
  hasOriginalPrice: boolean; // Purchase Return requires it explicitly; Sales Return derives it server-side
  sourceFields: { key: string; label: string }[]; // header-level "based on" ids (free-text — normally populated via Create Based On instead)
  reasonOptions: string[];
}

interface ReturnLineDraft {
  productId: string;
  unitId: string;
  quantity: string;
  originalUnitPrice: string;
  sourceReceiptLineId: string;
  sourceInvoiceLineId: string;
  reason: string;
}

function emptyReturnLine(): ReturnLineDraft {
  return { productId: '', unitId: '', quantity: '1', originalUnitPrice: '', sourceReceiptLineId: '', sourceInvoiceLineId: '', reason: '' };
}

/** Sales Return / Purchase Return — a bespoke pair (not the generic
 * DocListPage/DocDetailPage) because their lines reference a SOURCE line
 * (an original invoice/receipt line) rather than resolving price from a
 * price list. Manual creation exposes source line ids as plain text —
 * the intended path for a real return is "Create based on" from the
 * original Goods Receipt / Purchase Invoice (Purchase side) — which
 * defaults every field correctly and is available from those documents'
 * own detail pages. */
export function ReturnListPage({ kind }: { kind: ReturnKind }) {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [documents, setDocuments] = useState<BizDoc[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState('');
  const [reasonHeader, setReasonHeader] = useState(kind.reasonOptions[0] ?? '');
  const [sourceIds, setSourceIds] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<ReturnLineDraft[]>([emptyReturnLine()]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const [docs, cps, prods, uoms, whs] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/${kind.basePath}`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      ]);
      setDocuments(docs);
      setCounterparties(cps.filter((c) => c.counterpartyType === 'SUPPLIER' || c.counterpartyType === 'CUSTOMER' || c.counterpartyType === 'BOTH'));
      setProducts(prods);
      setUnits(uoms);
      setWarehouses(whs);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, kind.basePath]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        counterpartyId,
        documentDate,
        warehouseId: warehouseId || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          quantity: Number(l.quantity),
          ...(kind.hasOriginalPrice ? { originalUnitPrice: Number(l.originalUnitPrice) } : {}),
          ...(l.sourceReceiptLineId ? { sourceReceiptLineId: l.sourceReceiptLineId } : {}),
          ...(l.sourceInvoiceLineId ? { sourceInvoiceLineId: l.sourceInvoiceLineId } : {}),
          ...(l.reason ? { reason: l.reason } : {}),
        })),
      };
      const reasonField = kind.docType === 'SALES_RETURN' ? 'reasonCode' : 'returnReason';
      if (reasonHeader) payload[reasonField] = reasonHeader;
      for (const f of kind.sourceFields) {
        if (sourceIds[f.key]) payload[f.key] = sourceIds[f.key];
      }
      const created = await api.post<BizDoc>(`/organizations/${orgId}/${kind.basePath}`, payload);
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setLines([emptyReturnLine()]);
      setSourceIds({});
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission(kind.viewPerm)) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{kind.title}</h1>
        {hasPermission(kind.createPerm) && orgId && (
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
              <p className="panel-note">Tip: normally create this via "Create return…" on the original document — it fills source lines and quantities for you.</p>
              <div className="inline-form">
                <label>
                  {kind.counterpartyLabel}
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
                  {t.common.warehouse}
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.reason}
                  <select value={reasonHeader} onChange={(e) => setReasonHeader(e.target.value)}>
                    {kind.reasonOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                {kind.sourceFields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <input placeholder="id (optional)" value={sourceIds[f.key] ?? ''} onChange={(e) => setSourceIds({ ...sourceIds, [f.key]: e.target.value })} />
                  </label>
                ))}
              </div>

              {lines.map((line, i) => (
                <div className="inline-form" key={i}>
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
                  <label>
                    {t.common.quantity}
                    <input type="number" step="any" min="0" required value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                  </label>
                  {kind.hasOriginalPrice && (
                    <label>
                      Original price
                      <input type="number" step="any" min="0" required value={line.originalUnitPrice} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, originalUnitPrice: e.target.value } : l)))} />
                    </label>
                  )}
                  <label>
                    Source receipt line id
                    <input value={line.sourceReceiptLineId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, sourceReceiptLineId: e.target.value } : l)))} placeholder="optional" />
                  </label>
                  <label>
                    Source invoice line id
                    <input value={line.sourceInvoiceLineId} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, sourceInvoiceLineId: e.target.value } : l)))} placeholder="optional" />
                  </label>
                  <button type="button" className="small" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    {t.common.remove}
                  </button>
                </div>
              ))}
              <div className="inline-form">
                <button type="button" className="small" onClick={() => setLines([...lines, emptyReturnLine()])}>
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
            <p className="panel-note">No returns yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{kind.counterpartyLabel}</th>
                  <th>{t.common.grandTotal}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.posting}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/${kind.routePrefix}/${d.id}`}>{d.number ?? d.id.slice(0, 8)}</Link>
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

export function ReturnDetailPage({ kind }: { kind: ReturnKind }) {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<BizDoc>(`/organizations/${orgId}/${kind.basePath}/${id}`);
      setDoc(d);
      if (hasPermission('audit.view')) setAuditEvents(await api.get<AuditEvent[]>(`/audit-events?entityType=${kind.docType}&entityId=${id}`).catch(() => []));
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
  }, [id, orgId, kind.basePath, kind.docType]);

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
      await api.post(`/documents/${kind.docType}/${doc.id}/${command}`, { expectedVersion: doc.version });
      showSuccess(`Return ${command}ed`);
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
          </div>
        </div>
        <div className="actions">
          <Link to={`/${kind.routePrefix}`} className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && (
            <button className="primary" disabled={busy} onClick={() => runCommand('post')}>
              {t.common.post}
            </button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>
              {t.common.unpost}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{kind.counterpartyLabel}</dt>
          <dd>{cpName(doc.counterpartyId)}</dd>
          <dt>{t.common.documentDate}</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>{t.common.subtotal}</dt>
          <dd className="numeric">{doc.subtotal ?? '—'}</dd>
          <dt>{t.common.taxTotal}</dt>
          <dd className="numeric">{doc.taxTotal ?? '—'}</dd>
          <dt>{t.common.grandTotal}</dt>
          <dd className="numeric">{doc.grandTotal ?? '—'}</dd>
          <dt>{t.common.description}</dt>
          <dd>{doc.description ?? '—'}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>{t.common.lines}</h2>
        {(doc.lines ?? []).length === 0 ? (
          <p className="panel-note">{t.common.noLinesYet}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t.common.product}</th>
                <th>{t.common.unit}</th>
                <th>{t.common.quantity}</th>
                <th>Return net</th>
                <th>Return tax</th>
                <th>Return gross</th>
                <th>{t.common.reason}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines!.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td>{i + 1}</td>
                  <td>{productName(l.productId)}</td>
                  <td>{unitCode(l.unitId)}</td>
                  <td className="numeric">{l.quantity}</td>
                  <td className="numeric">{String(l.returnNet ?? '—')}</td>
                  <td className="numeric">{String(l.returnTax ?? '—')}</td>
                  <td className="numeric">{String(l.returnGross ?? '—')}</td>
                  <td>{l.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
