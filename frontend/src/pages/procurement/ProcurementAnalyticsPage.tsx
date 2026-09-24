import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { SalesProductRef } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

type ReportKey = 'expected-stock' | 'open-purchase-orders' | 'late-purchase-orders' | 'open-requirements' | 'demand-coverage' | 'supplier-candidates';

const REPORTS: { key: ReportKey; label: string; needsProduct?: boolean; optionalProduct?: boolean; needsQuantity?: boolean; optionalDate?: boolean }[] = [
  { key: 'expected-stock', label: 'Expected Stock', needsProduct: true },
  { key: 'open-purchase-orders', label: 'Open Purchase Orders' },
  { key: 'late-purchase-orders', label: 'Late Purchase Orders', optionalDate: true },
  { key: 'open-requirements', label: 'Open Requirements', optionalProduct: true },
  { key: 'demand-coverage', label: 'Demand Coverage', needsProduct: true },
  { key: 'supplier-candidates', label: 'Supplier Candidates', needsProduct: true, needsQuantity: true, optionalDate: true },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Phase 8 — Procurement analytics (spec sections 88-91, 112-113): expected
 * supply, open/late purchase orders, demand coverage, and supplier
 * candidate comparison — 6 read-only computed reports with zero frontend
 * consumers before this page. Mirrors PurchaseReportsPage's tab-strip. */
export function ProcurementAnalyticsPage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();

  const [active, setActive] = useState<ReportKey>('open-purchase-orders');
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  const orgId = currentOrganizationId;
  const reportDef = REPORTS.find((r) => r.key === active)!;

  useEffect(() => {
    if (!orgId) return;
    api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).then(setProducts).catch(() => {});
  }, [orgId]);

  const run = async () => {
    if (!orgId) return;
    if (reportDef.needsProduct && !productId) return showError(new Error('Product is required for this report.'));
    setLoading(true);
    setRows([]);
    try {
      const params = new URLSearchParams();
      if (reportDef.needsProduct || (reportDef.optionalProduct && productId)) params.set('productId', productId);
      if (reportDef.needsQuantity) params.set('quantity', quantity);
      if (reportDef.optionalDate && asOfDate) params.set(active === 'late-purchase-orders' ? 'asOfDate' : 'date', asOfDate);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<unknown>(`/organizations/${orgId}/procurement/${active}${qs}`);
      setRows(Array.isArray(data) ? (data as Record<string, unknown>[]) : [data as Record<string, unknown>]);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('purchase.supply_planning.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.procurementAnalytics}</h1>
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
            {reportDef.needsQuantity && (
              <label>
                Quantity *
                <input type="number" step="any" min="0" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </label>
            )}
            {reportDef.optionalDate && (
              <label>
                Date
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
              </label>
            )}
            <button className="primary" disabled={loading} onClick={run}>
              {loading ? t.common.loading : 'Run report'}
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
      )}
    </div>
  );
}
