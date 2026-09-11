import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, LineDraft, SalesCounterpartyRef, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { DocKind } from './DocKind';
import { DocLinesEditor, emptyDocLine, serializeDocLines } from './DocLinesEditor';

/** Generic org-scoped list + create screen driven by a `DocKind` config
 * (see DocKind.ts) — one implementation backing every "priced document"
 * kind (Sales/Purchase Order, Sales/Purchase Invoice, Goods Receipt,
 * Shipment) instead of a bespoke page per kind. */
export function DocListPage({ kind }: { kind: DocKind }) {
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
  const [priceIncludesTax, setPriceIncludesTax] = useState(false);
  const [description, setDescription] = useState('');
  const [headerWarehouseId, setHeaderWarehouseId] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineDraft[]>([emptyDocLine()]);

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
      setCounterparties(cps.filter((c) => kind.counterpartyTypes.includes(c.counterpartyType)));
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
    if (lines.some((l) => !l.productId || !l.unitId)) {
      showError(new Error('Every line needs a product and a unit'));
      return;
    }
    if (kind.headerWarehouse && !headerWarehouseId) {
      showError(new Error('A warehouse is required'));
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        counterpartyId,
        documentDate,
        description: description || undefined,
        lines: serializeDocLines(lines, { showPrice: kind.showPrice, showTax: kind.showTax, showWarehouse: kind.showLineWarehouse }),
      };
      if (kind.hasPriceIncludesTax) payload.priceIncludesTax = priceIncludesTax;
      if (kind.headerWarehouse) payload.warehouseId = headerWarehouseId;
      for (const f of kind.extraFields ?? []) {
        if (extra[f.key]) payload[f.key] = f.type === 'checkbox' ? extra[f.key] === 'true' : extra[f.key];
      }
      const created = await api.post<BizDoc>(`/organizations/${orgId}/${kind.basePath}`, payload);
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setCounterpartyId('');
      setDescription('');
      setHeaderWarehouseId('');
      setExtra({});
      setLines([emptyDocLine()]);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission(kind.viewPerm)) {
    return <p className="panel-note">{t.common.noPermissionView}</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{kind.title}</h1>
        {hasPermission(kind.createPerm) && orgId && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : `+ ${t.common.create} ${kind.singular}`}
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
                {kind.headerWarehouse && (
                  <label>
                    {t.common.warehouse}
                    <select required value={headerWarehouseId} onChange={(e) => setHeaderWarehouseId(e.target.value)}>
                      <option value="" disabled>
                        {t.common.select}
                      </option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {kind.extraFields?.map((f) =>
                  f.type === 'checkbox' ? (
                    <label className="checkbox-row" key={f.key}>
                      <input type="checkbox" checked={extra[f.key] === 'true'} onChange={(e) => setExtra({ ...extra, [f.key]: String(e.target.checked) })} />
                      {f.label}
                    </label>
                  ) : f.type === 'date' ? (
                    <label key={f.key}>
                      {f.label}
                      <input type="date" required={f.required} value={extra[f.key] ?? ''} onChange={(e) => setExtra({ ...extra, [f.key]: e.target.value })} />
                    </label>
                  ) : f.type === 'select-static' ? (
                    <label key={f.key}>
                      {f.label}
                      <select required={f.required} value={extra[f.key] ?? ''} onChange={(e) => setExtra({ ...extra, [f.key]: e.target.value })}>
                        <option value="">{t.common.select}</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={f.key}>
                      {f.label}
                      <input required={f.required} value={extra[f.key] ?? ''} onChange={(e) => setExtra({ ...extra, [f.key]: e.target.value })} />
                    </label>
                  ),
                )}
                {kind.hasPriceIncludesTax && (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={priceIncludesTax} onChange={(e) => setPriceIncludesTax(e.target.checked)} />
                    {t.common.pricesIncludeTax}
                  </label>
                )}
                <label>
                  {t.common.description}
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>
              <DocLinesEditor lines={lines} setLines={setLines} products={products} units={units} warehouses={warehouses} showPrice={kind.showPrice} showTax={kind.showTax} showWarehouse={kind.showLineWarehouse} priceHint={kind.priceHint} />
              <div className="inline-form">
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : documents.length === 0 ? (
            <p className="panel-note">{kind.emptyHint}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{kind.counterpartyLabel}</th>
                  {kind.showPrice && <th>{t.common.grandTotal}</th>}
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
                    <td>{counterparties.find((c) => c.id === d.counterpartyId)?.name ?? (d.counterpartyId ? `${d.counterpartyId.slice(0, 8)}…` : '—')}</td>
                    {kind.showPrice && <td className="numeric">{d.grandTotal ?? d.totalCost ?? '—'}</td>}
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
