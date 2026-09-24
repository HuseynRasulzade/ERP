import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Currency, SalesCounterpartyRef, SalesProductRef, SalesUnitRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface PriceListHeader {
  id: string;
  priceListType: 'SALE' | 'PURCHASE';
  code: string;
  name: string;
  description: string | null;
  currencyId: string;
  validFrom: string;
  validTo: string | null;
  counterpartyId: string | null;
  priority: number;
  includesTax: boolean;
  active: boolean;
  version: number;
}

interface ProductPriceLine {
  id: string;
  priceListId: string;
  productId: string;
  unitId: string;
  price: string;
  minQuantity: string;
  maxQuantity: string | null;
  active: boolean;
  version: number;
  product?: { id: string; code: string; name: string };
  unit?: { id: string; code: string };
}

/** Phase 3 - Price List & Product Price admin (section 90-92): flat
 * master-data CRUD (no document lifecycle), mirroring SupplierProductCodePage's
 * shape, plus a per-header line-management panel for ProductPrice rows. */
export function PriceListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [lists, setLists] = useState<PriceListHeader[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'PURCHASE'>('ALL');

  const [priceListType, setPriceListType] = useState<'SALE' | 'PURCHASE'>('SALE');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [priority, setPriority] = useState('0');
  const [includesTax, setIncludesTax] = useState(false);

  const [selected, setSelected] = useState<PriceListHeader | null>(null);
  const [lines, setLines] = useState<ProductPriceLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lineProductId, setLineProductId] = useState('');
  const [lineUnitId, setLineUnitId] = useState('');
  const [linePrice, setLinePrice] = useState('');
  const [lineMinQuantity, setLineMinQuantity] = useState('');
  const [lineMaxQuantity, setLineMaxQuantity] = useState('');
  const [lineSubmitting, setLineSubmitting] = useState(false);

  const orgId = currentOrganizationId;
  const canManageLists = hasPermission('price_list.create') || hasPermission('price_list.edit');
  const canManagePrices = hasPermission('product_price.manage');

  const load = useCallback(async () => {
    if (!orgId) {
      setLists([]);
      return;
    }
    setLoading(true);
    try {
      const [pls, curr, cps, prods, uoms] = await Promise.all([
        api.get<PriceListHeader[]>(`/organizations/${orgId}/price-lists?includeInactive=true`),
        api.get<Currency[]>('/currencies').catch(() => []),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setLists(pls);
      setCurrencies(curr);
      setCounterparties(cps);
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

  const loadLines = useCallback(async (priceListId: string) => {
    if (!orgId) return;
    setLinesLoading(true);
    try {
      const detail = await api.get<PriceListHeader & { prices: ProductPriceLine[] }>(`/organizations/${orgId}/price-lists/${priceListId}`);
      setLines(detail.prices);
    } catch (err) {
      showError(err);
    } finally {
      setLinesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const openList = (pl: PriceListHeader) => {
    setSelected(pl);
    setLineProductId('');
    setLineUnitId('');
    setLinePrice('');
    setLineMinQuantity('');
    setLineMaxQuantity('');
    loadLines(pl.id);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/price-lists`, {
        priceListType,
        code,
        name,
        currencyId,
        validFrom,
        validTo: validTo || undefined,
        counterpartyId: counterpartyId || undefined,
        priority: priority ? Number(priority) : undefined,
        includesTax,
      });
      showSuccess('Saved');
      setCode('');
      setName('');
      setValidFrom('');
      setValidTo('');
      setCounterpartyId('');
      setPriority('0');
      setIncludesTax(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onDeactivateList = async (pl: PriceListHeader) => {
    if (!orgId) return;
    try {
      await api.post(`/organizations/${orgId}/price-lists/${pl.id}/deactivate`, { expectedVersion: pl.version });
      showSuccess('Saved');
      await load();
      if (selected?.id === pl.id) setSelected(null);
    } catch (err) {
      showError(err);
    }
  };

  const onAddLine = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !selected) return;
    setLineSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/price-lists/${selected.id}/prices`, {
        productId: lineProductId,
        unitId: lineUnitId,
        price: Number(linePrice),
        minQuantity: lineMinQuantity ? Number(lineMinQuantity) : undefined,
        maxQuantity: lineMaxQuantity ? Number(lineMaxQuantity) : undefined,
      });
      showSuccess('Saved');
      setLineProductId('');
      setLineUnitId('');
      setLinePrice('');
      setLineMinQuantity('');
      setLineMaxQuantity('');
      await loadLines(selected.id);
    } catch (err) {
      showError(err);
    } finally {
      setLineSubmitting(false);
    }
  };

  const onDeactivateLine = async (line: ProductPriceLine) => {
    if (!orgId || !selected) return;
    try {
      await api.post(`/organizations/${orgId}/price-lists/${selected.id}/prices/${line.id}/deactivate`, { expectedVersion: line.version });
      showSuccess('Saved');
      await loadLines(selected.id);
    } catch (err) {
      showError(err);
    }
  };

  if (!hasPermission('price_list.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const visibleLists = typeFilter === 'ALL' ? lists : lists.filter((l) => l.priceListType === typeFilter);

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.priceLists}</h1>
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
                {o.code} - {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          {canManageLists && (
            <form onSubmit={onCreate} className="inline-form">
              <label>
                Type
                <select value={priceListType} onChange={(e) => setPriceListType(e.target.value as 'SALE' | 'PURCHASE')}>
                  <option value="SALE">SALE</option>
                  <option value="PURCHASE">PURCHASE</option>
                </select>
              </label>
              <label>
                Code
                <input required value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label>
                Name
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                {t.common.currency}
                <select required value={currencyId} onChange={(e) => setCurrencyId(e.target.value)}>
                  <option value="" disabled>
                    {t.common.select}
                  </option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valid from
                <input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </label>
              <label>
                Valid to
                <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </label>
              <label>
                {t.common.counterparty} (optional)
                <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                  <option value="">-</option>
                  {counterparties.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </label>
              <label>
                Includes tax
                <input type="checkbox" checked={includesTax} onChange={(e) => setIncludesTax(e.target.checked)} />
              </label>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? t.common.saving : t.common.save}
              </button>
            </form>
          )}

          <div className="inline-form">
            <label>
              Filter
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'ALL' | 'SALE' | 'PURCHASE')}>
                <option value="ALL">All</option>
                <option value="SALE">SALE</option>
                <option value="PURCHASE">PURCHASE</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : visibleLists.length === 0 ? (
            <p className="panel-note">No price lists yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Currency</th>
                  <th>Valid from</th>
                  <th>Valid to</th>
                  <th>{t.common.counterparty}</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleLists.map((pl) => (
                  <tr key={pl.id} className={selected?.id === pl.id ? 'row-selected' : undefined}>
                    <td className="mono">
                      <button type="button" onClick={() => openList(pl)}>
                        {pl.code}
                      </button>
                    </td>
                    <td>{pl.name}</td>
                    <td>{pl.priceListType}</td>
                    <td>{currencies.find((c) => c.id === pl.currencyId)?.code ?? pl.currencyId.slice(0, 8)}</td>
                    <td>{pl.validFrom?.slice(0, 10)}</td>
                    <td>{pl.validTo?.slice(0, 10) ?? '-'}</td>
                    <td>{pl.counterpartyId ? counterparties.find((c) => c.id === pl.counterpartyId)?.name ?? pl.counterpartyId.slice(0, 8) : '-'}</td>
                    <td className="numeric">{pl.priority}</td>
                    <td>
                      <span className={`badge badge-generic-${pl.active ? 'success' : 'neutral'}`}>{pl.active ? 'ACTIVE' : 'INACTIVE'}</span>
                    </td>
                    <td>
                      {pl.active && hasPermission('price_list.deactivate') && (
                        <button type="button" onClick={() => onDeactivateList(pl)}>
                          {t.counterparty.deactivate}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selected && (
            <section className="card">
              <div className="page-header">
                <h2>
                  {selected.code} - {selected.name} ({selected.priceListType})
                </h2>
                <button type="button" onClick={() => setSelected(null)}>
                  {t.common.close}
                </button>
              </div>

              {canManagePrices && (
                <form onSubmit={onAddLine} className="inline-form">
                  <label>
                    {t.common.product}
                    <select required value={lineProductId} onChange={(e) => setLineProductId(e.target.value)}>
                      <option value="" disabled>
                        {t.common.select}
                      </option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Unit
                    <select required value={lineUnitId} onChange={(e) => setLineUnitId(e.target.value)}>
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
                    Price
                    <input type="number" step="any" min="0" required value={linePrice} onChange={(e) => setLinePrice(e.target.value)} />
                  </label>
                  <label>
                    Min qty
                    <input type="number" step="any" min="0" value={lineMinQuantity} onChange={(e) => setLineMinQuantity(e.target.value)} placeholder="1" />
                  </label>
                  <label>
                    Max qty
                    <input type="number" step="any" min="0" value={lineMaxQuantity} onChange={(e) => setLineMaxQuantity(e.target.value)} />
                  </label>
                  <button type="submit" className="primary" disabled={lineSubmitting}>
                    {lineSubmitting ? t.common.saving : t.common.save}
                  </button>
                </form>
              )}

              {linesLoading ? (
                <p className="panel-note">{t.common.loading}</p>
              ) : lines.length === 0 ? (
                <p className="panel-note">No product prices yet.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.common.product}</th>
                      <th>Unit</th>
                      <th>Price</th>
                      <th>Min qty</th>
                      <th>Max qty</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.product ? `${line.product.code} - ${line.product.name}` : products.find((p) => p.id === line.productId)?.name ?? line.productId.slice(0, 8)}</td>
                        <td>{line.unit?.code ?? units.find((u) => u.id === line.unitId)?.code ?? line.unitId.slice(0, 8)}</td>
                        <td className="numeric">{line.price}</td>
                        <td className="numeric">{line.minQuantity}</td>
                        <td className="numeric">{line.maxQuantity ?? '-'}</td>
                        <td>
                          <span className={`badge badge-generic-${line.active ? 'success' : 'neutral'}`}>{line.active ? 'ACTIVE' : 'INACTIVE'}</span>
                        </td>
                        <td>
                          {line.active && canManagePrices && (
                            <button type="button" onClick={() => onDeactivateLine(line)}>
                              {t.counterparty.deactivate}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
