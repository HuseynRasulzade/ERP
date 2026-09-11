import { useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

const REPORTS = [
  { key: 'purchase-register', label: 'Purchase Register', dated: true },
  { key: 'supplier-invoice-register', label: 'Supplier Invoice Register', dated: true },
  { key: 'goods-received-not-invoiced', label: 'Goods Received Not Invoiced', dated: false },
  { key: 'purchase-price-variance', label: 'Purchase Price Variance', dated: true },
  { key: 'purchase-returns', label: 'Purchase Returns', dated: true },
] as const;

export function PurchaseReportsPage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();

  const [active, setActive] = useState<(typeof REPORTS)[number]['key']>('purchase-register');
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  const orgId = currentOrganizationId;
  const reportDef = REPORTS.find((r) => r.key === active)!;

  const run = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const qs = reportDef.dated ? `?fromDate=${fromDate}&toDate=${toDate}` : '';
      const data = await api.get<Record<string, unknown>[]>(`/organizations/${orgId}/reports/${active}${qs}`);
      setRows(data);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission('purchase_execution.view_accounting')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.purchaseReports}</h1>
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
            {reportDef.dated && (
              <>
                <label>
                  From
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </label>
                <label>
                  To
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </label>
              </>
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
