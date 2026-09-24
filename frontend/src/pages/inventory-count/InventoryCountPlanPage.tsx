import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Warehouse } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { InventoryCountPlan, InventoryCountSession } from './types';
import { statusBadgeClass } from './types';

const COUNT_TYPES = ['FULL', 'PARTIAL', 'CYCLE', 'ANNUAL', 'AD_HOC', 'INVESTIGATION'];

export function InventoryCountPlanListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [plans, setPlans] = useState<InventoryCountPlan[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [countType, setCountType] = useState('FULL');
  const [reason, setReason] = useState('');
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<string[]>([]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setPlans([]);
      return;
    }
    setLoading(true);
    try {
      const [p, w] = await Promise.all([
        api.get<InventoryCountPlan[]>(`/organizations/${orgId}/inventory-count/plans`),
        api.get<Warehouse[]>(`/organizations/${orgId}/warehouses`).catch(() => []),
      ]);
      setPlans(p);
      setWarehouses(w);
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

  const toggleWarehouse = (id: string) => {
    setSelectedWarehouseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (selectedWarehouseIds.length === 0) {
      showError(new Error('Select at least one warehouse to include in the count scope'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/inventory-count/plans`, {
        planDate,
        countType,
        reason: reason || undefined,
        scopes: selectedWarehouseIds.map((warehouseId) => ({ includeExclude: 'INCLUDE', warehouseId })),
      });
      showSuccess('Count plan created');
      setShowForm(false);
      setSelectedWarehouseIds([]);
      setReason('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory Count Plans</h1>
          <p className="page-subtitle">Phase 12 — define what gets counted, then start a session against it.</p>
        </div>
        <div className="actions">
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>
              {t.common.selectOrganization}
            </option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {orgId && hasPermission('inventory_count.plan') && (
            <button className="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? t.common.cancel : '+ New plan'}
            </button>
          )}
        </div>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : (
        <>
          {showForm && (
            <form className="card" onSubmit={submit}>
              <div className="form-grid">
                <label>
                  {t.common.date}
                  <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} required />
                </label>
                <label>
                  Count type
                  <select value={countType} onChange={(e) => setCountType(e.target.value)}>
                    {COUNT_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {ct}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.reason}
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Year-end physical count" />
                </label>
              </div>

              <p className="panel-note" style={{ marginTop: 0 }}>
                Scope — warehouses to include in this count
              </p>
              <div className="badge-row" style={{ flexWrap: 'wrap' }}>
                {warehouses.map((w) => (
                  <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={selectedWarehouseIds.includes(w.id)} onChange={() => toggleWarehouse(w.id)} />
                    {w.name} ({w.code})
                  </label>
                ))}
                {warehouses.length === 0 && <span className="panel-note">No warehouses in this organization yet.</span>}
              </div>

              <div className="actions" style={{ marginTop: 14 }}>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.create}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : plans.length === 0 ? (
            <p className="panel-note">No count plans yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>Type</th>
                  <th>Scope rows</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/inventory-count/plans/${p.id}`}>{p.number ?? p.id.slice(0, 8)}</Link>
                    </td>
                    <td>{p.planDate.slice(0, 10)}</td>
                    <td>{p.countType}</td>
                    <td>{p.scopes?.length ?? '—'}</td>
                    <td>
                      <span className={statusBadgeClass(p.status)}>{p.status}</span>
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

export function InventoryCountPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<InventoryCountPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const p = await api.get<InventoryCountPlan>(`/organizations/${orgId}/inventory-count/plans/${id}`);
      setPlan(p);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!plan) return <p className="panel-note">{t.common.loading}</p>;

  const markReady = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/inventory-count/plans/${plan.id}/mark-ready`, { expectedVersion: plan.version });
      showSuccess('Plan marked READY');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const startSession = async () => {
    setBusy(true);
    try {
      const session = await api.post<InventoryCountSession>(`/organizations/${orgId}/inventory-count/sessions`, { inventoryCountPlanId: plan.id });
      showSuccess('Count session started');
      navigate(`/inventory-count/sessions/${session.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link to="/inventory-count/plans" className="link-muted">
        {t.common.backToList}
      </Link>

      <div className="page-header">
        <div>
          <h1>{plan.number ?? plan.id.slice(0, 8)}</h1>
          <div className="badge-row">
            <span className={statusBadgeClass(plan.status)}>{plan.status}</span>
            <span className="badge">{plan.countType}</span>
            {plan.blindCountEnabled && <span className="badge">Blind count</span>}
          </div>
        </div>
        <div className="actions">
          {plan.status === 'DRAFT' && hasPermission('inventory_count.plan') && (
            <button className="primary" onClick={markReady} disabled={busy || (plan.scopes?.length ?? 0) === 0}>
              Mark ready
            </button>
          )}
          {plan.status === 'READY' && hasPermission('inventory_count.start_session') && (
            <button className="primary" onClick={startSession} disabled={busy}>
              Start session
            </button>
          )}
        </div>
      </div>

      {(plan.scopes?.length ?? 0) === 0 && plan.status === 'DRAFT' && (
        <p className="panel-note">This plan has no scope yet — a session cannot start until at least one warehouse (or other scope row) is included.</p>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scope</h3>
        {(plan.scopes?.length ?? 0) === 0 ? (
          <p className="panel-note">No scope rows.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>{t.common.warehouse}</th>
                <th>Location</th>
                <th>{t.common.product}</th>
                <th>Batch</th>
                <th>Ownership</th>
                <th>Quality status</th>
              </tr>
            </thead>
            <tbody>
              {(plan.scopes ?? []).map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className={`badge badge-generic-${s.includeExclude === 'INCLUDE' ? 'ok' : 'bad'}`}>{s.includeExclude}</span>
                  </td>
                  <td>{s.warehouseId ? s.warehouseId.slice(0, 8) : 'Any'}</td>
                  <td>{s.locationId ? s.locationId.slice(0, 8) : 'Any'}</td>
                  <td>{s.productId ? s.productId.slice(0, 8) : s.productGroupId ? `Category ${s.productGroupId.slice(0, 8)}` : 'Any'}</td>
                  <td>{s.batchId ? s.batchId.slice(0, 8) : 'Any'}</td>
                  <td>{s.ownershipType ?? 'Any'}</td>
                  <td>{s.qualityStatus ?? 'Any'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {plan.sessions && plan.sessions.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Sessions</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.number}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {plan.sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/inventory-count/sessions/${s.id}`}>{s.sessionNumber ?? s.id.slice(0, 8)}</Link>
                  </td>
                  <td>
                    <span className={statusBadgeClass(s.status)}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
