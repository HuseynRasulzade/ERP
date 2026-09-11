import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, SalesCounterpartyRef, SalesProductRef } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

const ALLOCATION_METHODS = ['BY_QUANTITY', 'BY_VALUE', 'BY_WEIGHT', 'BY_VOLUME', 'EQUALLY', 'MANUAL'];
const COST_TYPES = ['TRANSPORT', 'CUSTOMS', 'INSURANCE', 'LOADING', 'BROKER', 'FREIGHT', 'HANDLING', 'CERTIFICATION', 'OTHER'];

interface ReceiptOption {
  id: string;
  number: string | null;
  lines: { id: string; productId: string; quantity: string }[];
}

export function AdditionalPurchaseCostListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<BizDoc[]>([]);
  const [suppliers, setSuppliers] = useState<SalesCounterpartyRef[]>([]);
  const [receipts, setReceipts] = useState<ReceiptOption[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [costType, setCostType] = useState('TRANSPORT');
  const [allocationMethod, setAllocationMethod] = useState('BY_VALUE');
  const [totalCost, setTotalCost] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [selectedLines, setSelectedLines] = useState<Record<string, boolean>>({});
  const [coefficients, setCoefficients] = useState<Record<string, string>>({});

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [costs, cps, grs, prods] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/additional-purchase-costs`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<ReceiptOption[]>(`/organizations/${orgId}/goods-receipts`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
      ]);
      setItems(costs);
      setSuppliers(cps);
      setReceipts(grs);
      setProducts(prods);
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

  const [receiptLines, setReceiptLines] = useState<{ id: string; productId: string; quantity: string }[]>([]);
  useEffect(() => {
    if (!orgId || !receiptId) {
      setReceiptLines([]);
      return;
    }
    api
      .get<ReceiptOption>(`/organizations/${orgId}/goods-receipts/${receiptId}`)
      .then((r) => setReceiptLines(r.lines))
      .catch(() => setReceiptLines([]));
  }, [orgId, receiptId]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const targetLines = Object.keys(selectedLines)
      .filter((k) => selectedLines[k])
      .map((lineId) => ({ goodsReceiptLineId: lineId, ...(allocationMethod === 'MANUAL' && coefficients[lineId] ? { manualCoefficient: Number(coefficients[lineId]) } : {}) }));
    if (targetLines.length === 0) {
      showError(new Error('Select at least one goods receipt line to allocate against'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<BizDoc>(`/organizations/${orgId}/additional-purchase-costs`, {
        counterpartyId,
        documentDate,
        costType,
        allocationMethod,
        totalCost: Number(totalCost),
        targetLines,
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setTotalCost('');
      setSelectedLines({});
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
        <h1>{t.nav.additionalCosts}</h1>
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
              <div className="inline-form">
                <label>
                  Cost supplier
                  <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="" disabled>
                      {t.common.select}
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                <label>
                  Cost type
                  <select value={costType} onChange={(e) => setCostType(e.target.value)}>
                    {COST_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Allocation method
                  <select value={allocationMethod} onChange={(e) => setAllocationMethod(e.target.value)}>
                    {ALLOCATION_METHODS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.total} cost
                  <input type="number" step="any" min="0.01" required value={totalCost} onChange={(e) => setTotalCost(e.target.value)} />
                </label>
              </div>

              <div className="inline-form">
                <label>
                  Goods receipt to allocate against
                  <select value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    {receipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.number ?? r.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {receiptLines.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>{t.common.product}</th>
                      <th>{t.common.quantity}</th>
                      {allocationMethod === 'MANUAL' && <th>Coefficient</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {receiptLines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <input type="checkbox" checked={!!selectedLines[l.id]} onChange={(e) => setSelectedLines({ ...selectedLines, [l.id]: e.target.checked })} />
                        </td>
                        <td>{products.find((p) => p.id === l.productId)?.name ?? l.productId.slice(0, 8)}</td>
                        <td className="numeric">{l.quantity}</td>
                        {allocationMethod === 'MANUAL' && (
                          <td>
                            <input type="number" step="any" style={{ width: 80 }} value={coefficients[l.id] ?? ''} onChange={(e) => setCoefficients({ ...coefficients, [l.id]: e.target.value })} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

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
            <p className="panel-note">No additional purchase costs yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>Method</th>
                  <th>{t.common.total}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.posting}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/additional-costs/${d.id}`}>{d.number ?? d.id.slice(0, 8)}</Link>
                    </td>
                    <td>{d.documentDate.slice(0, 10)}</td>
                    <td className="mono">{String(d.allocationMethod ?? '—')}</td>
                    <td className="numeric">{d.totalCost ?? '—'}</td>
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

export function AdditionalPurchaseCostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [allocations, setAllocations] = useState<{ goodsReceiptLineId: string; productId: string; allocatedAmount: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<BizDoc & { allocations?: typeof allocations }>(`/organizations/${orgId}/additional-purchase-costs/${id}`);
      setDoc(d);
      setAllocations(d.allocations ?? []);
      setProducts(await api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []));
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
      await api.post(`/documents/ADDITIONAL_PURCHASE_COST/${doc.id}/${command}`, { expectedVersion: doc.version });
      showSuccess(`Additional cost ${command}ed`);
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
          <Link to="/additional-costs" className="link-muted">
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
          <dt>Cost type</dt>
          <dd>{String(doc.costType ?? '—')}</dd>
          <dt>Allocation method</dt>
          <dd className="mono">{String(doc.allocationMethod ?? '—')}</dd>
          <dt>{t.common.total} cost</dt>
          <dd className="numeric">{doc.totalCost ?? '—'}</dd>
          <dt>{t.common.tax}</dt>
          <dd className="numeric">{String(doc.taxAmount ?? '—')}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Allocation result</h2>
        {allocations.length === 0 ? (
          <p className="panel-note">Not allocated yet — post the document to compute allocations.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.product}</th>
                <th>Allocated amount</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a, i) => (
                <tr key={i}>
                  <td>{products.find((p) => p.id === a.productId)?.name ?? a.productId.slice(0, 8)}</td>
                  <td className="numeric">{a.allocatedAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
