import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Currency, SalesProductRef, Warehouse } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

interface CostingPolicy {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  costingMethod: string;
  averageMethod: string | null;
  valuationCurrencyId: string;
  status: string;
}

type Tab = 'valuation' | 'cogs' | 'layers' | 'policies';

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Phase 11 — Inventory Costing Engine (core: FIFO + Weighted Average,
 * COGS, valuation). Minimal admin/reporting UI over the engine's read
 * API — this build's costing logic itself lives entirely on the
 * backend (inventory-costing module), never re-derived client-side. */
export function InventoryCostingPage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [tab, setTab] = useState<Tab>('valuation');
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [policies, setPolicies] = useState<CostingPolicy[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');

  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [costingMethod, setCostingMethod] = useState<'FIFO' | 'WEIGHTED_AVERAGE'>('WEIGHTED_AVERAGE');
  const [valuationCurrencyId, setValuationCurrencyId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orgId = currentOrganizationId;

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
      api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      api.get<Currency[]>('/currencies').catch(() => []),
    ]).then(([p, w, c]) => {
      setProducts(p);
      setWarehouses(w);
      setCurrencies(c);
    });
  }, [orgId]);

  const loadPolicies = async () => {
    if (!orgId) return;
    try {
      setPolicies(await api.get<CostingPolicy[]>(`/organizations/${orgId}/inventory-costing/policy`));
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    if (tab === 'policies') loadPolicies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, orgId]);

  const run = async () => {
    if (!orgId) return;
    setLoading(true);
    setRows([]);
    try {
      const params = new URLSearchParams();
      if (productFilter) params.set('productId', productFilter);
      if (warehouseFilter && tab === 'valuation') params.set('warehouseId', warehouseFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<Record<string, unknown>[]>(`/organizations/${orgId}/inventory-costing/${tab}${qs}`);
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const createPolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/inventory-costing/policy`, {
        effectiveFrom, costingMethod, valuationCurrencyId,
        averageMethod: costingMethod === 'WEIGHTED_AVERAGE' ? 'MOVING_AVERAGE' : undefined,
      });
      showSuccess('Saved');
      await loadPolicies();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('inventory_cost.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.inventoryCosting}</h1>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <div className="tab-strip">
            <button className={`tab ${tab === 'valuation' ? 'active' : ''}`} onClick={() => setTab('valuation')}>Valuation</button>
            <button className={`tab ${tab === 'cogs' ? 'active' : ''}`} onClick={() => setTab('cogs')}>COGS</button>
            <button className={`tab ${tab === 'layers' ? 'active' : ''}`} onClick={() => setTab('layers')}>FIFO Layers</button>
            {hasPermission('inventory_cost.policy_manage') && (
              <button className={`tab ${tab === 'policies' ? 'active' : ''}`} onClick={() => setTab('policies')}>Costing Policy</button>
            )}
          </div>

          {tab !== 'policies' ? (
            <>
              <div className="inline-form">
                <label>
                  {t.common.product}
                  <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                    <option value="">All</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                </label>
                {tab === 'valuation' && (
                  <label>
                    Warehouse
                    <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
                      <option value="">All</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="primary" disabled={loading} onClick={run}>
                  {loading ? t.common.loading : 'Run'}
                </button>
              </div>

              {rows.length === 0 ? (
                <p className="panel-note">No rows yet — run the report.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>
                          {columns.map((c) => (
                            <td key={c} className={typeof row[c] === 'number' ? 'numeric' : undefined}>
                              {renderCell(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              {hasPermission('inventory_cost.policy_manage') && (
                <form onSubmit={createPolicy} className="inline-form">
                  <label>
                    Effective from
                    <input type="date" required value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </label>
                  <label>
                    Costing method
                    <select value={costingMethod} onChange={(e) => setCostingMethod(e.target.value as 'FIFO' | 'WEIGHTED_AVERAGE')}>
                      <option value="WEIGHTED_AVERAGE">WEIGHTED_AVERAGE</option>
                      <option value="FIFO">FIFO</option>
                    </select>
                  </label>
                  <label>
                    {t.common.currency}
                    <select required value={valuationCurrencyId} onChange={(e) => setValuationCurrencyId(e.target.value)}>
                      <option value="" disabled>{t.common.select}</option>
                      {currencies.map((c) => (
                        <option key={c.id} value={c.id}>{c.code}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="primary" disabled={submitting}>
                    {submitting ? t.common.saving : t.common.save}
                  </button>
                </form>
              )}
              <p className="panel-note">A new policy takes effect from its date forward; the currently active policy is automatically closed the day before. Method changes cannot be made retroactive.</p>
              {policies.length === 0 ? (
                <p className="panel-note">No policy configured yet — one will be created automatically with WEIGHTED_AVERAGE defaults the first time a movement is costed.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>Effective from</th><th>Effective to</th><th>Method</th><th>Average method</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {policies.map((p) => (
                      <tr key={p.id}>
                        <td>{p.effectiveFrom?.slice(0, 10)}</td>
                        <td>{p.effectiveTo?.slice(0, 10) ?? '—'}</td>
                        <td>{p.costingMethod}</td>
                        <td>{p.averageMethod ?? '—'}</td>
                        <td><span className={`badge badge-generic-${p.effectiveTo === null ? 'success' : 'neutral'}`}>{p.effectiveTo === null ? 'ACTIVE' : 'CLOSED'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
