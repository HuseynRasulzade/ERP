import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { SalesProductRef, Warehouse } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

type ReportKey = 'stock-balance' | 'stock-card' | 'batches' | 'serials' | 'serial-history' | 'negative-stock' | 'min-max' | 'snapshot';

const REPORTS: { key: ReportKey; label: string; needsWarehouse?: boolean; needsProduct?: boolean; needsSerial?: boolean; optionalWarehouse?: boolean; optionalProduct?: boolean; optionalBatch?: boolean }[] = [
  { key: 'stock-balance', label: 'Stock Balance', optionalWarehouse: true, optionalProduct: true },
  { key: 'stock-card', label: 'Stock Card', needsWarehouse: true, needsProduct: true, optionalBatch: true },
  { key: 'batches', label: 'Batches', optionalProduct: true },
  { key: 'serials', label: 'Serials', optionalProduct: true },
  { key: 'serial-history', label: 'Serial History', needsSerial: true },
  { key: 'negative-stock', label: 'Negative Stock' },
  { key: 'min-max', label: 'Min / Max', optionalWarehouse: true },
  { key: 'snapshot', label: 'Product Snapshot', needsWarehouse: true, needsProduct: true },
];

/** Phase 10 — Warehouse Inventory Reports (spec section ~104-115): 8 report
 * endpoints already existed on the backend with zero frontend consumers.
 * Mirrors PurchaseReportsPage's tab-strip + generic-table pattern, adapted
 * to warehouse/product/serial filter selects instead of just dates. */
export function InventoryReportsPage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();

  const [active, setActive] = useState<ReportKey>('stock-balance');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [serialId, setSerialId] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const orgId = currentOrganizationId;
  const reportDef = REPORTS.find((r) => r.key === active)!;

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
    ]).then(([w, p]) => {
      setWarehouses(w);
      setProducts(p);
    });
  }, [orgId]);

  const run = async () => {
    if (!orgId) return;
    if (reportDef.needsWarehouse && !warehouseId) return showError(new Error('Warehouse is required for this report.'));
    if (reportDef.needsProduct && !productId) return showError(new Error('Product is required for this report.'));
    if (reportDef.needsSerial && !serialId) return showError(new Error('Serial number ID is required for this report.'));

    setLoading(true);
    setRows([]);
    setSnapshot(null);
    try {
      if (active === 'snapshot') {
        const data = await api.get<Record<string, unknown>>(`/organizations/${orgId}/warehouses/${warehouseId}/products/${productId}/stock`);
        setSnapshot(data);
        return;
      }
      if (active === 'serial-history') {
        const data = await api.get<Record<string, unknown>[]>(`/organizations/${orgId}/inventory-reports/serials/${serialId}/history`);
        setRows(data);
        return;
      }
      const params = new URLSearchParams();
      if (reportDef.needsWarehouse || (reportDef.optionalWarehouse && warehouseId)) params.set('warehouseId', warehouseId);
      if (reportDef.needsProduct || (reportDef.optionalProduct && productId)) params.set('productId', productId);
      if (reportDef.optionalBatch && batchId) params.set('batchId', batchId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<Record<string, unknown>[]>(`/organizations/${orgId}/inventory-reports/${active}${qs}`);
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('inventory.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.inventoryReports}</h1>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          <div className="tab-strip">
            {REPORTS.map((r) => (
              <button key={r.key} className={`tab ${active === r.key ? 'active' : ''}`} onClick={() => setActive(r.key)}>
                {r.label}
              </button>
            ))}
          </div>

          <div className="inline-form">
            {(reportDef.needsWarehouse || reportDef.optionalWarehouse) && (
              <label>
                Warehouse{reportDef.needsWarehouse ? ' *' : ''}
                <select required={reportDef.needsWarehouse} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">{reportDef.needsWarehouse ? t.common.select : 'All'}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                  ))}
                </select>
              </label>
            )}
            {(reportDef.needsProduct || reportDef.optionalProduct) && (
              <label>
                {t.common.product}{reportDef.needsProduct ? ' *' : ''}
                <select required={reportDef.needsProduct} value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">{reportDef.needsProduct ? t.common.select : 'All'}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </label>
            )}
            {reportDef.optionalBatch && (
              <label>
                Batch ID
                <input value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="optional" />
              </label>
            )}
            {reportDef.needsSerial && (
              <label>
                Serial number ID *
                <input required value={serialId} onChange={(e) => setSerialId(e.target.value)} />
              </label>
            )}
            <button className="primary" disabled={loading} onClick={run}>
              {loading ? t.common.loading : 'Run report'}
            </button>
          </div>

          {active === 'snapshot' ? (
            !snapshot ? (
              <p className="panel-note">No data yet — run the report.</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {Object.entries(snapshot).map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td className="numeric">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : rows.length === 0 ? (
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
                        <td key={c} className={typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? 'numeric' : undefined}>
                          {String(row[c] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
