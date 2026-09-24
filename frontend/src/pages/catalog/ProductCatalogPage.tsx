import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Product, ProductCategory, ProductParentCategory, UnitOfMeasure } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { exportToCsv } from '../../utils/csvExport';

const PRODUCT_TYPES = ['GOODS', 'SERVICE', 'WORK', 'SET'];
const TRACKING_MODES = ['NONE', 'OPTIONAL', 'REQUIRED'];

type Tab = 'products' | 'categories' | 'parentCategories' | 'units';

/** Product Catalog (docx spec Phase 2, "nomenklatura") — units of
 * measure (tenant-wide), product categories and products (both
 * org-scoped) in one page with internal tabs, mirroring the tab-strip
 * pattern OrganizationDetailPage already uses. This is the master data
 * every document line (Sales/Purchase Order, Shipment, Goods Receipt,
 * the Phase 10 warehouse documents, ...) references — previously only
 * reachable via the API/seed script, with no UI of its own. */
export function ProductCatalogPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>('products');

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.productCatalog}</h1>
      </div>

      <nav className="tab-strip">
        <button className={tab === 'products' ? 'tab active' : 'tab'} onClick={() => setTab('products')}>
          {t.catalog.products}
        </button>
        <button className={tab === 'categories' ? 'tab active' : 'tab'} onClick={() => setTab('categories')}>
          {t.catalog.categories}
        </button>
        <button className={tab === 'parentCategories' ? 'tab active' : 'tab'} onClick={() => setTab('parentCategories')}>
          {t.catalog.parentCategories}
        </button>
        <button className={tab === 'units' ? 'tab active' : 'tab'} onClick={() => setTab('units')}>
          {t.catalog.units}
        </button>
      </nav>

      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'parentCategories' && <ParentCategoriesTab />}
      {tab === 'units' && <UnitsTab />}
    </div>
  );
}

function OrgSelector() {
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { t } = useLocale();
  return (
    <div className="inline-form">
      <label>
        {t.common.organization}
        <select value={currentOrganizationId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
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
  );
}

function ProductsTab() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [productType, setProductType] = useState('GOODS');
  const [baseUnitId, setBaseUnitId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [batchTrackingMode, setBatchTrackingMode] = useState('NONE');
  const [serialTrackingMode, setSerialTrackingMode] = useState('NONE');

  const load = () => {
    if (!orgId) {
      setProducts([]);
      return;
    }
    Promise.all([
      api.get<Product[]>(`/organizations/${orgId}/products`),
      api.get<ProductCategory[]>(`/organizations/${orgId}/product-categories`).catch(() => []),
      api.get<UnitOfMeasure[]>('/units-of-measure').catch(() => []),
    ])
      .then(([p, c, u]) => {
        setProducts(p);
        setCategories(c);
        setUnits(u);
      })
      .catch(showError);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const reset = () => {
    setCode('');
    setName('');
    setProductType('GOODS');
    setBaseUnitId('');
    setCategoryId('');
    setSku('');
    setBarcode('');
    setBatchTrackingMode('NONE');
    setSerialTrackingMode('NONE');
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post<Product>(`/organizations/${orgId}/products`, {
        code,
        name,
        productType,
        baseUnitId,
        categoryId: categoryId || undefined,
        sku: sku || undefined,
        barcode: barcode || undefined,
        batchTrackingMode,
        serialTrackingMode,
      });
      showSuccess(t.toast.createdItem(code));
      reset();
      setShowForm(false);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (p: Product) => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/products/${p.id}/deactivate`, { expectedVersion: p.version });
      showSuccess(t.catalog.deactivated(p.name));
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const categoryName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? id.slice(0, 8)) : '—');
  const unitCode = (id: string) => units.find((u) => u.id === id)?.code ?? id.slice(0, 8);

  return (
    <div>
      <OrgSelector />
      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <div className="page-header">
            <h2>{t.catalog.products}</h2>
            <div className="actions">
              {products.length > 0 && (
                <button
                  onClick={() =>
                    exportToCsv(
                      t.catalog.products,
                      [
                        { header: t.catalog.code, value: (p: Product) => p.code },
                        { header: t.common.name, value: (p: Product) => p.name },
                        { header: t.catalog.productType, value: (p: Product) => p.productType },
                        { header: 'SKU', value: (p: Product) => p.sku },
                        { header: 'Barcode', value: (p: Product) => p.barcode },
                        { header: 'Manufacturer', value: (p: Product) => p.manufacturer },
                        { header: t.common.status, value: (p: Product) => (p.active ? 'ACTIVE' : 'INACTIVE') },
                      ],
                      products,
                    )
                  }
                >
                  {t.common.exportExcel}
                </button>
              )}
              {hasPermission('product.create') && (
                <button className="primary" onClick={() => setShowForm((s) => !s)}>
                  {showForm ? t.common.cancel : `+ ${t.common.create} ${t.catalog.product}`}
                </button>
              )}
            </div>
          </div>

          {showForm && (
            <form onSubmit={create} className="card">
              <div className="inline-form">
                <label>
                  {t.catalog.code}
                  <input required value={code} onChange={(e) => setCode(e.target.value)} />
                </label>
                <label>
                  {t.common.name}
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {t.catalog.productType}
                  <select value={productType} onChange={(e) => setProductType(e.target.value)}>
                    {PRODUCT_TYPES.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.unit}
                  <select required value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)}>
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
                  {t.catalog.categories}
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  SKU
                  <input value={sku} onChange={(e) => setSku(e.target.value)} />
                </label>
                <label>
                  {t.catalog.barcode}
                  <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                </label>
                <label>
                  {t.catalog.batchTracking}
                  <select value={batchTrackingMode} onChange={(e) => setBatchTrackingMode(e.target.value)}>
                    {TRACKING_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.catalog.serialTracking}
                  <select value={serialTrackingMode} onChange={(e) => setSerialTrackingMode(e.target.value)}>
                    {TRACKING_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="inline-form">
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {products.length === 0 ? (
            <p className="panel-note">{t.catalog.noProductsYet}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.catalog.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.catalog.productType}</th>
                  <th>{t.common.unit}</th>
                  <th>{t.catalog.categories}</th>
                  <th>{t.catalog.batchTracking}</th>
                  <th>{t.catalog.serialTracking}</th>
                  <th>{t.common.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.code}</td>
                    <td>{p.name}</td>
                    <td>{p.productType}</td>
                    <td>{unitCode(p.baseUnitId)}</td>
                    <td>{categoryName(p.categoryId)}</td>
                    <td>{p.batchTrackingMode}</td>
                    <td>{p.serialTrackingMode}</td>
                    <td>{p.active ? t.catalog.active : t.catalog.inactive}</td>
                    <td>
                      {p.active && hasPermission('product.deactivate') && (
                        <button className="small" disabled={busy} onClick={() => deactivate(p)}>
                          {t.catalog.deactivate}
                        </button>
                      )}
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

function CategoriesTab() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [parentGroups, setParentGroups] = useState<ProductParentCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [parentGroupId, setParentGroupId] = useState('');
  const [parentGroupSearch, setParentGroupSearch] = useState('');

  const load = () => {
    if (!orgId) {
      setCategories([]);
      setParentGroups([]);
      return;
    }
    api.get<ProductCategory[]>(`/organizations/${orgId}/product-categories`).then(setCategories).catch(showError);
    api
      .get<ProductParentCategory[]>(`/organizations/${orgId}/product-parent-categories`)
      .then(setParentGroups)
      .catch(showError);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      const res = await api.post<ProductCategory>(`/organizations/${orgId}/product-categories`, {
        name,
        parentGroupId: parentGroupId || undefined,
      });
      showSuccess(t.toast.createdItem(res.code));
      setName('');
      setParentGroupId('');
      setParentGroupSearch('');
      setShowForm(false);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (c: ProductCategory) => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/product-categories/${c.id}/deactivate`, { expectedVersion: c.version });
      showSuccess(t.catalog.deactivated(c.name));
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const parentGroupName = (id: string | null) => (id ? (parentGroups.find((p) => p.id === id)?.name ?? id.slice(0, 8)) : '—');

  const filteredParentGroups = useMemo(() => {
    const q = parentGroupSearch.trim().toLowerCase();
    if (!q) return parentGroups;
    return parentGroups.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [parentGroups, parentGroupSearch]);

  return (
    <div>
      <OrgSelector />
      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <div className="page-header">
            <h2>{t.catalog.categories}</h2>
            {hasPermission('product_category.create') && (
              <button className="primary" onClick={() => setShowForm((s) => !s)}>
                {showForm ? t.common.cancel : `+ ${t.common.create} ${t.catalog.category}`}
              </button>
            )}
          </div>

          {showForm && (
            <form onSubmit={create} className="card">
              <div className="inline-form">
                <label>
                  {t.common.name}
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {t.catalog.searchParentCategory}
                  <input value={parentGroupSearch} onChange={(e) => setParentGroupSearch(e.target.value)} />
                </label>
                <label>
                  {t.catalog.parentCategory}
                  <select value={parentGroupId} onChange={(e) => setParentGroupId(e.target.value)}>
                    <option value="">{t.catalog.noParentCategory}</option>
                    {filteredParentGroups.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {categories.length === 0 ? (
            <p className="panel-note">{t.catalog.noCategoriesYet}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.catalog.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.catalog.parentCategory}</th>
                  <th>{t.common.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>{parentGroupName(c.parentGroupId)}</td>
                    <td>{c.active ? t.catalog.active : t.catalog.inactive}</td>
                    <td>
                      {c.active && hasPermission('product_category.deactivate') && (
                        <button className="small" disabled={busy} onClick={() => deactivate(c)}>
                          {t.catalog.deactivate}
                        </button>
                      )}
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

function ParentCategoriesTab() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [items, setItems] = useState<ProductParentCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  const load = () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    api.get<ProductParentCategory[]>(`/organizations/${orgId}/product-parent-categories`).then(setItems).catch(showError);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      const res = await api.post<ProductParentCategory>(`/organizations/${orgId}/product-parent-categories`, { name });
      showSuccess(t.toast.createdItem(res.code));
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (p: ProductParentCategory) => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/product-parent-categories/${p.id}/deactivate`, { expectedVersion: p.version });
      showSuccess(t.catalog.deactivated(p.name));
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <OrgSelector />
      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <div className="page-header">
            <h2>{t.catalog.parentCategories}</h2>
            {hasPermission('product_parent_category.create') && (
              <button className="primary" onClick={() => setShowForm((s) => !s)}>
                {showForm ? t.common.cancel : `+ ${t.common.create} ${t.catalog.parentCategories}`}
              </button>
            )}
          </div>

          {showForm && (
            <form onSubmit={create} className="card">
              <div className="inline-form">
                <label>
                  {t.common.name}
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {items.length === 0 ? (
            <p className="panel-note">{t.catalog.noParentCategoriesYet}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.catalog.code}</th>
                  <th>{t.common.name}</th>
                  <th>{t.common.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.code}</td>
                    <td>{p.name}</td>
                    <td>{p.active ? t.catalog.active : t.catalog.inactive}</td>
                    <td>
                      {p.active && hasPermission('product_parent_category.deactivate') && (
                        <button className="small" disabled={busy} onClick={() => deactivate(p)}>
                          {t.catalog.deactivate}
                        </button>
                      )}
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

function UnitsTab() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [unitType, setUnitType] = useState('QUANTITY');

  const load = () => api.get<UnitOfMeasure[]>('/units-of-measure').then(setUnits).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post<UnitOfMeasure>('/units-of-measure', { code, name, symbol: symbol || undefined, unitType });
      showSuccess(t.toast.createdItem(code));
      setCode('');
      setName('');
      setSymbol('');
      setShowForm(false);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (u: UnitOfMeasure) => {
    setBusy(true);
    try {
      await api.post(`/units-of-measure/${u.id}/deactivate`, { expectedVersion: u.version });
      showSuccess(t.catalog.deactivated(u.name));
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t.catalog.units}</h2>
        {hasPermission('unit_of_measure.create') && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : `+ ${t.common.create} ${t.catalog.unit}`}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={create} className="card">
          <div className="inline-form">
            <label>
              {t.catalog.code}
              <input required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              {t.common.name}
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t.catalog.symbol}
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </label>
            <label>
              {t.catalog.unitType}
              <input value={unitType} onChange={(e) => setUnitType(e.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t.common.saving : t.common.save}
            </button>
          </div>
        </form>
      )}

      {units.length === 0 ? (
        <p className="panel-note">{t.catalog.noUnitsYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.catalog.code}</th>
              <th>{t.common.name}</th>
              <th>{t.catalog.symbol}</th>
              <th>{t.catalog.unitType}</th>
              <th>{t.common.status}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td>{u.code}</td>
                <td>{u.name}</td>
                <td>{u.symbol ?? '—'}</td>
                <td>{u.unitType}</td>
                <td>{u.active ? t.catalog.active : t.catalog.inactive}</td>
                <td>
                  {u.active && hasPermission('unit_of_measure.deactivate') && (
                    <button className="small" disabled={busy} onClick={() => deactivate(u)}>
                      {t.catalog.deactivate}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
