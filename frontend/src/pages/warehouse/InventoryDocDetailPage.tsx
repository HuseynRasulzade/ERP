import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { InventoryDocKind } from './InventoryDocKind';

/** Generic detail screen for a Phase 10 "quantity document" — header,
 * lines, generic post/unpost/cancel, and (WarehouseTransfer TWO_STEP
 * only) a bespoke receive command. See InventoryDocListPage's docstring
 * for why this doesn't reuse the priced-document DocDetailPage. */
export function InventoryDocDetailPage({ kind }: { kind: InventoryDocKind }) {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [busy, setBusy] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const [d, prods, uoms, whs] = await Promise.all([
        api.get<BizDoc>(`/organizations/${orgId}/${kind.basePath}/${id}`),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      ]);
      setDoc(d);
      setProducts(prods);
      setUnits(uoms);
      setWarehouses(whs);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId, kind.basePath]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const productName = (pid?: string) => (pid ? (products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)) : '—');
  const unitCode = (uid?: string) => (uid ? (units.find((u) => u.id === uid)?.code ?? uid.slice(0, 8)) : '—');
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

  const runReceive = async () => {
    if (!doc.lines) return;
    const receiveLines = doc.lines
      .map((l) => ({ lineId: l.id as string, quantity: Number(receiveQty[l.id as string] ?? 0) }))
      .filter((l) => l.quantity > 0);
    if (receiveLines.length === 0) {
      showError(new Error('Enter a quantity to receive on at least one line'));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/${kind.basePath}/${doc.id}/receive`, { expectedVersion: doc.version, lines: receiveLines });
      showSuccess(t.toast.documentAction(kind.singular, t.common.posted));
      setReceiveQty({});
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const isTwoStepTransfer = kind.docType === 'WAREHOUSE_TRANSFER' && doc.transferType === 'TWO_STEP';

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{doc.number ?? doc.id}</h1>
          <div className="badge-row">
            <StatusBadge kind="document" value={doc.status} />
            <StatusBadge kind="posting" value={doc.postingStatus} />
            {isTwoStepTransfer && typeof doc.transferStatus === 'string' && <span className="badge">{doc.transferStatus}</span>}
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
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          {kind.warehouseShape === 'single' ? (
            <>
              <dt>{t.common.warehouse}</dt>
              <dd>{whCode(doc.warehouseId)}</dd>
            </>
          ) : (
            <>
              <dt>Source Warehouse</dt>
              <dd>{whCode(doc.sourceWarehouseId as string | undefined)}</dd>
              <dt>Destination Warehouse</dt>
              <dd>{whCode(doc.destinationWarehouseId as string | undefined)}</dd>
            </>
          )}
          <dt>{t.common.documentDate}</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          {kind.headerFields?.map((f) => (
            <Fragment key={f.key}>
              <dt>{f.label}</dt>
              <dd>{String(doc[f.key] ?? '—')}</dd>
            </Fragment>
          ))}
          <dt>{t.common.postedAt}</dt>
          <dd>{doc.postedAt ?? '—'}</dd>
          <dt>{t.common.description}</dt>
          <dd>{doc.description ?? '—'}</dd>
          <dt>{t.common.version}</dt>
          <dd>{doc.version}</dd>
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
                {isTwoStepTransfer && <th>Received</th>}
                {kind.lineFields?.map((f) => <th key={f.key}>{f.label}</th>)}
                {isTwoStepTransfer && doc.postingStatus === 'POSTED' && doc.transferStatus !== 'RECEIVED' && <th>Receive Now</th>}
              </tr>
            </thead>
            <tbody>
              {doc.lines!.map((l, i) => (
                <tr key={(l.id as string) ?? i}>
                  <td>{i + 1}</td>
                  <td>{productName(l.productId as string)}</td>
                  <td>{unitCode(l.unitId as string)}</td>
                  <td className="numeric">{l.quantity as string}</td>
                  {isTwoStepTransfer && <td className="numeric">{(l.receivedQuantity as string) ?? '0'}</td>}
                  {kind.lineFields?.map((f) => (
                    <td key={f.key}>{String(l[f.key] ?? '—')}</td>
                  ))}
                  {isTwoStepTransfer && doc.postingStatus === 'POSTED' && doc.transferStatus !== 'RECEIVED' && (
                    <td>
                      <input type="number" step="any" min="0" style={{ width: '5rem' }} value={receiveQty[l.id as string] ?? ''} onChange={(e) => setReceiveQty({ ...receiveQty, [l.id as string]: e.target.value })} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isTwoStepTransfer && doc.postingStatus === 'POSTED' && doc.transferStatus !== 'RECEIVED' && hasPermission('inventory.transfer.receive') && (
          <div className="inline-form">
            <button className="primary" disabled={busy} onClick={runReceive}>
              Receive
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
