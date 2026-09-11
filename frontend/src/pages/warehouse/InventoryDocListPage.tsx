import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { InventoryDocKind } from './InventoryDocKind';

interface LineDraft {
  productId: string;
  unitId: string;
  quantity: string;
  extra: Record<string, string>;
}

function emptyLine(): LineDraft {
  return { productId: '', unitId: '', quantity: '1', extra: {} };
}

/** Generic org-scoped list + create screen driven by an `InventoryDocKind`
 * config (see InventoryDocKind.ts) — one implementation backing every
 * Phase 10 "quantity document" kind instead of a bespoke page per kind. */
export function InventoryDocListPage({ kind }: { kind: InventoryDocKind }) {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [documents, setDocuments] = useState<BizDoc[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState('');
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [description, setDescription] = useState('');
  const [header, setHeader] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const [docs, prods, uoms, whs] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/${kind.basePath}`),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      ]);
      setDocuments(docs);
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
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        documentDate,
        description: description || undefined,
        lines: lines.map((l) => {
          const extra: Record<string, unknown> = {};
          for (const f of kind.lineFields ?? []) {
            const v = l.extra[f.key];
            if (v) extra[f.key] = f.type === 'number' ? Number(v) : v;
          }
          return { productId: l.productId, unitId: l.unitId, quantity: Number(l.quantity), ...extra };
        }),
      };
      if (kind.warehouseShape === 'single') payload.warehouseId = warehouseId;
      else {
        payload.sourceWarehouseId = sourceWarehouseId;
        payload.destinationWarehouseId = destinationWarehouseId;
      }
      for (const f of kind.headerFields ?? []) {
        if (header[f.key]) payload[f.key] = header[f.key];
      }
      const created = await api.post<BizDoc>(`/organizations/${orgId}/${kind.basePath}`, payload);
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setDescription('');
      setWarehouseId('');
      setSourceWarehouseId('');
      setDestinationWarehouseId('');
      setHeader({});
      setLines([emptyLine()]);
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
                {kind.warehouseShape === 'single' ? (
                  <label>
                    {t.common.warehouse}
                    <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
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
                ) : (
                  <>
                    <label>
                      Source Warehouse
                      <select required value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)}>
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
                    <label>
                      Destination Warehouse
                      <select required value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)}>
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
                  </>
                )}
                <label>
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                {kind.headerFields?.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.type === 'select-static' ? (
                      <select required={f.required} value={header[f.key] ?? ''} onChange={(e) => setHeader({ ...header, [f.key]: e.target.value })}>
                        <option value="">{t.common.select}</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input required={f.required} value={header[f.key] ?? ''} onChange={(e) => setHeader({ ...header, [f.key]: e.target.value })} />
                    )}
                  </label>
                ))}
                <label>
                  {t.common.description}
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>

              <div>
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
                            {u.symbol ? ` (${u.symbol})` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t.common.quantity}
                      <input type="number" step="any" min="0" required value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                    </label>
                    {kind.lineFields?.map((f) => (
                      <label key={f.key}>
                        {f.label}
                        {f.type === 'select-static' ? (
                          <select
                            required={f.required}
                            value={line.extra[f.key] ?? ''}
                            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, extra: { ...l.extra, [f.key]: e.target.value } } : l)))}
                          >
                            <option value="">{t.common.select}</option>
                            {f.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={f.type === 'number' ? 'number' : 'text'}
                            value={line.extra[f.key] ?? ''}
                            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, extra: { ...l.extra, [f.key]: e.target.value } } : l)))}
                          />
                        )}
                      </label>
                    ))}
                    <button type="button" className="small" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      {t.common.remove}
                    </button>
                  </div>
                ))}
                <button type="button" className="small" onClick={() => setLines([...lines, emptyLine()])}>
                  {t.common.addLine}
                </button>
              </div>

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
