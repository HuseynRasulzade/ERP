import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditEvent, BizDoc, DocumentLink, LineDraft, SalesCounterpartyRef, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { DocKind } from './DocKind';
import { DocLinesEditor, serializeDocLines } from './DocLinesEditor';

const ROUTE_BY_DOC_TYPE: Record<string, string> = {
  SALES_ORDER: 'sales-orders',
  SALES_INVOICE: 'sales-invoices',
  CUSTOMER_REQUEST: 'customer-requests',
  COMMERCIAL_OFFER: 'commercial-offers',
  SHIPMENT: 'shipments',
  SALES_RETURN: 'sales-returns',
  PURCHASE_REQUIREMENT: 'purchase-requirements',
  PURCHASE_ORDER: 'purchase-orders',
  GOODS_RECEIPT: 'goods-receipts',
  PURCHASE_INVOICE: 'purchase-invoices',
  PURCHASE_RETURN: 'purchase-returns',
  ADDITIONAL_PURCHASE_COST: 'additional-costs',
};

/** Generic document detail: header, lines, post/unpost/cancel, Create
 * Based On, document links, audit trail — one implementation for every
 * `DocKind` (see DocListPage's docstring). `renderExtras` lets a specific
 * kind (Purchase Order holds, Purchase Invoice matching, ...) inject its
 * own extra cards below the generic ones without forking this file. */
export function DocDetailPage({ kind, renderExtras }: { kind: DocKind; renderExtras?: (doc: BizDoc, reload: () => void) => ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const [d, l] = await Promise.all([
        api.get<BizDoc>(`/organizations/${orgId}/${kind.basePath}/${id}`),
        api.get<DocumentLink[]>(`/document-links?documentType=${kind.docType}&documentId=${id}`).catch(() => []),
      ]);
      setDoc(d);
      setLinks(l);
      if (hasPermission('audit.view')) {
        const audit = await api.get<AuditEvent[]>(`/audit-events?entityType=${kind.docType}&entityId=${id}`).catch(() => []);
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
  }, [id, orgId, kind.basePath, kind.docType]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const productName = (pid?: string) => (pid ? (products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)) : '—');
  const unitCode = (uid?: string) => (uid ? (units.find((u) => u.id === uid)?.code ?? uid.slice(0, 8)) : '—');
  const cpName = (cid?: string) => (cid ? (counterparties.find((c) => c.id === cid)?.name ?? `${cid.slice(0, 8)}…`) : '—');
  const whCode = (wid?: string | null) => (wid ? (warehouses.find((w) => w.id === wid)?.code ?? wid.slice(0, 8)) : '—');

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/${kind.docType}/${doc.id}/${command}`, { expectedVersion: doc.version });
      const labelByCmd = { post: t.common.posted, unpost: t.common.unposted, cancel: t.common.cancelled } as const;
      showSuccess(t.toast.documentAction(kind.singular, labelByCmd[command]));
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createBasedOn = async (target: { docType: string; routePrefix: string; label: string }) => {
    setBusy(true);
    try {
      const created = await api.post<BizDoc>(`/documents/${kind.docType}/${doc.id}/create-based-on/${target.docType}`, {});
      showSuccess(`${target.label} → ${created.number ?? created.id.slice(0, 8)}`);
      navigate(`/${target.routePrefix}/${created.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const startEditingLines = () => {
    setLineDrafts(
      (doc.lines ?? []).map((l) => ({
        productId: (l.productId as string) ?? '',
        unitId: (l.unitId as string) ?? '',
        quantity: String(l.quantity ?? ''),
        price: l.price != null ? String(l.price) : '',
        taxRate: l.taxRate != null ? String(l.taxRate) : '',
        warehouseId: (l.warehouseId as string) ?? '',
        description: (l.description as string) ?? '',
        lineType: (l.lineType as string) ?? 'INVENTORY',
        requirementLineId: (l.requirementLineId as string) ?? undefined,
      })),
    );
    setEditingLines(true);
  };

  const saveLines = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const lines = serializeDocLines(lineDrafts, { showPrice: kind.showPrice, showTax: kind.showTax, showWarehouse: kind.showLineWarehouse });
      await api.patch(`/organizations/${orgId}/${kind.basePath}/${doc.id}`, { expectedVersion: doc.version, lines });
      showSuccess(t.toast.updatedItem(doc.number ?? doc.id));
      setEditingLines(false);
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
          {kind.editLinesPerm && hasPermission(kind.editLinesPerm) && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && !editingLines && (
            <button disabled={busy} onClick={startEditingLines}>
              {t.common.edit}
            </button>
          )}
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
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>
              {t.common.cancel}
            </button>
          )}
          {kind.createBasedOnTargets?.map((target) => (
            <button key={target.docType} disabled={busy} onClick={() => createBasedOn(target)}>
              {target.label} …
            </button>
          ))}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{kind.counterpartyLabel}</dt>
          <dd>{cpName(doc.counterpartyId)}</dd>
          <dt>{t.common.documentDate}</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          {kind.headerWarehouse && (
            <>
              <dt>{t.common.warehouse}</dt>
              <dd>{whCode(doc.warehouseId)}</dd>
            </>
          )}
          <dt>{t.common.postedAt}</dt>
          <dd>{doc.postedAt ?? '—'}</dd>
          {kind.showPrice && (
            <>
              <dt>{t.common.subtotal}</dt>
              <dd className="numeric">{doc.subtotal ?? '—'}</dd>
              <dt>{t.common.taxTotal}</dt>
              <dd className="numeric">{doc.taxTotal ?? '—'}</dd>
              <dt>{t.common.grandTotal}</dt>
              <dd className="numeric">{doc.grandTotal ?? doc.totalCost ?? '—'}</dd>
            </>
          )}
          {kind.headerDisplayFields?.map((f) => (
            <>
              <dt key={`${f.key}-dt`}>{f.label}</dt>
              <dd key={`${f.key}-dd`}>{String(doc[f.key] ?? '—')}</dd>
            </>
          ))}
          <dt>{t.common.description}</dt>
          <dd>{doc.description ?? '—'}</dd>
          <dt>{t.common.version}</dt>
          <dd>{doc.version}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>{t.common.lines}</h2>
        {editingLines ? (
          <form onSubmit={saveLines}>
            <DocLinesEditor
              lines={lineDrafts}
              setLines={setLineDrafts}
              products={products}
              units={units}
              warehouses={warehouses}
              showPrice={kind.showPrice}
              showTax={kind.showTax}
              showWarehouse={kind.showLineWarehouse}
              priceHint={kind.priceHint}
            />
            <div className="inline-form">
              <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
              <button type="button" onClick={() => setEditingLines(false)}>{t.common.cancel}</button>
            </div>
          </form>
        ) : (doc.lines ?? []).length === 0 ? (
          <p className="panel-note">{t.common.noLinesYet}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t.common.product}</th>
                <th>{t.common.unit}</th>
                <th>{t.common.quantity}</th>
                {kind.showPrice && <th>{t.common.price}</th>}
                {kind.showTax && <th>{t.common.taxRate}</th>}
                {kind.showLineWarehouse && <th>{t.common.warehouse}</th>}
                {kind.showPrice && (
                  <>
                    <th>{t.common.lineTotal}</th>
                    <th>{t.common.tax}</th>
                    <th>{t.common.totalWithTax}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.lines!.map((l, i) => {
                const missingPrice = kind.showPrice && (l.price === null || l.price === undefined);
                return (
                <tr key={l.id ?? i} className={missingPrice ? 'row-missing-price' : undefined}>
                  <td>{i + 1}</td>
                  <td>{productName(l.productId)}</td>
                  <td>{unitCode(l.unitId)}</td>
                  <td className="numeric">{l.quantity}</td>
                  {kind.showPrice && (
                    <td className="numeric">
                      {missingPrice ? <span className="badge badge-generic-warn" title={t.common.missingPriceHint}>{t.common.missingPrice}</span> : l.price}
                    </td>
                  )}
                  {kind.showTax && <td className="numeric">{l.taxRate ?? '—'}</td>}
                  {kind.showLineWarehouse && <td>{whCode(l.warehouseId as string | undefined)}</td>}
                  {kind.showPrice && (
                    <>
                      <td className="numeric">{l.lineTotal ?? '—'}</td>
                      <td className="numeric">{l.taxAmount ?? '—'}</td>
                      <td className="numeric">{l.lineTotalWithTax ?? '—'}</td>
                    </>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {renderExtras?.(doc, load)}

      <section className="card">
        <h2>{t.common.documentLinks}</h2>
        {links.length === 0 ? (
          <p className="panel-note">{t.common.noRelatedDocuments}</p>
        ) : (
          <ul className="link-list">
            {links.map((l) => {
              const isSource = l.sourceDocumentId === doc.id;
              const otherType = isSource ? l.targetDocumentType : l.sourceDocumentType;
              const otherId = isSource ? l.targetDocumentId : l.sourceDocumentId;
              const otherRoute = ROUTE_BY_DOC_TYPE[otherType] ? `/${ROUTE_BY_DOC_TYPE[otherType]}/${otherId}` : `/documents/${otherId}`;
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
