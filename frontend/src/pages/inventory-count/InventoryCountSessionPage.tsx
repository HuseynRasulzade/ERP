import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { InventoryCountSession, InventoryCountSheet } from './types';
import { statusBadgeClass } from './types';

export function InventoryCountSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [session, setSession] = useState<InventoryCountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const s = await api.get<InventoryCountSession>(`/organizations/${orgId}/inventory-count/sessions/${id}`);
      setSession(s);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!session) return <p className="panel-note">{t.common.loading}</p>;

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      showSuccess(successMessage);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = () => run(() => api.post(`/organizations/${orgId}/inventory-count/sessions/${session.id}/snapshot`), 'Snapshot created — the book quantity is now frozen for this count');
  const generateSheets = () => run(() => api.post(`/organizations/${orgId}/inventory-count/sessions/${session.id}/sheets/generate`, {}), 'Count sheets generated');
  const beginCounting = () => run(() => api.post(`/organizations/${orgId}/inventory-count/sessions/${session.id}/begin-counting`), 'Counting has begun');
  const complete = () => run(() => api.post(`/organizations/${orgId}/inventory-count/sessions/${session.id}/complete`), 'Session moved to review');

  const sheets = session.sheets ?? [];
  const allSheetsCompleted = sheets.length > 0 && sheets.every((s) => s.status === 'COMPLETED');

  return (
    <div>
      <Link to={`/inventory-count/plans/${session.inventoryCountPlanId}`} className="link-muted">
        ← Back to plan
      </Link>

      <div className="page-header">
        <div>
          <h1>{session.sessionNumber ?? session.id.slice(0, 8)}</h1>
          <div className="badge-row">
            <span className={statusBadgeClass(session.status)}>{session.status}</span>
            <span className="badge">{session.freezePolicy}</span>
            {session.blindCount && <span className="badge">Blind count</span>}
          </div>
          <p className="page-subtitle">
            {session.snapshotAt ? `Snapshot taken ${new Date(session.snapshotAt).toLocaleString()}` : 'No snapshot yet — the book quantity has not been frozen.'}
          </p>
        </div>
        <div className="actions">
          {session.status === 'DRAFT' && hasPermission('inventory_count.start_session') && (
            <button className="primary" onClick={createSnapshot} disabled={busy}>
              Create snapshot
            </button>
          )}
          {session.status === 'SNAPSHOT_CREATED' && sheets.length === 0 && hasPermission('inventory_count.start_session') && (
            <button className="primary" onClick={generateSheets} disabled={busy}>
              Generate count sheets
            </button>
          )}
          {session.status === 'SNAPSHOT_CREATED' && sheets.length > 0 && hasPermission('inventory_count.start_session') && (
            <button className="primary" onClick={beginCounting} disabled={busy}>
              Begin counting
            </button>
          )}
          {session.status === 'COUNTING' && hasPermission('inventory_count.enter') && (
            <button className="primary" onClick={complete} disabled={busy || !allSheetsCompleted} title={!allSheetsCompleted ? 'Every count sheet must be completed first' : undefined}>
              Complete session
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Count sheets</h3>
        {sheets.length === 0 ? (
          <p className="panel-note">
            {session.status === 'DRAFT' ? 'Create the snapshot first, then generate count sheets.' : 'No count sheets generated yet.'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.number}</th>
                <th>{t.common.warehouse}</th>
                <th>Location</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet: InventoryCountSheet) => (
                <tr key={sheet.id}>
                  <td>
                    <Link to={`/inventory-count/sessions/${session.id}/sheets/${sheet.id}`}>{sheet.sheetNumber ?? sheet.id.slice(0, 8)}</Link>
                  </td>
                  <td>{sheet.warehouseId.slice(0, 8)}</td>
                  <td>{sheet.locationId ? sheet.locationId.slice(0, 8) : '—'}</td>
                  <td>
                    <span className={statusBadgeClass(sheet.status)}>{sheet.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
