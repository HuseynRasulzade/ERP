import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Department, SalesProductRef, SalesUnitRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface ReqLine {
  id: string;
  productId: string;
  unitId: string;
  quantity: string;
  cancelledQuantity: string;
}
interface Requirement {
  id: string;
  number: string | null;
  documentDate: string;
  status: string;
  priority: string;
  version: number;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  createdByName?: string | null;
  lines: ReqLine[];
}
interface LineDraft {
  productId: string;
  unitId: string;
  quantity: string;
}

const STATUS_CLASS: Record<string, string> = { OPEN: 'ok', PARTIALLY_ORDERED: 'warn', FULLY_ORDERED: 'ok', CANCELLED: 'bad', CLOSED: 'neutral' };

export function PurchaseRequirementListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<Requirement[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState('NORMAL');
  const [departmentId, setDepartmentId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ productId: '', unitId: '', quantity: '1' }]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [reqs, prods, uoms, depts, mine] = await Promise.all([
        api.get<Requirement[]>(`/organizations/${orgId}/purchase-requirements`),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<Department[]>(`/organizations/${orgId}/departments`).catch(() => []),
        api.get<{ departmentId: string | null } | null>(`/organizations/${orgId}/access/mine`).catch(() => null),
      ]);
      setItems(reqs);
      setProducts(prods);
      setUnits(uoms);
      setDepartments(depts);
      // Department auto-fill: default the create form to the logged-in
      // user's own department for this organization (spec requirement) —
      // still freely changeable before submit.
      setDepartmentId((current) => current || mine?.departmentId || '');
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

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<Requirement>(`/organizations/${orgId}/purchase-requirements`, {
        documentDate,
        priority,
        departmentId: departmentId || undefined,
        lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: Number(l.quantity) })),
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setLines([{ productId: '', unitId: '', quantity: '1' }]);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('purchase.requirement.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.purchaseRequirements}</h1>
        {hasPermission('purchase.requirement.create') && orgId && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : `+ ${t.common.create}`}
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
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                <label>
                  Priority
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.procurement.department}
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.common.quantity}
                    <input type="number" step="any" min="0" required value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                  </label>
                  <button type="button" className="small" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    {t.common.remove}
                  </button>
                </div>
              ))}
              <div className="inline-form">
                <button type="button" className="small" onClick={() => setLines([...lines, { productId: '', unitId: '', quantity: '1' }])}>
                  {t.common.addLine}
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="panel-note">No purchase requirements yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>Priority</th>
                  <th>{t.procurement.department}</th>
                  <th>{t.procurement.createdBy}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/purchase-requirements/${r.id}`}>{r.number ?? r.id.slice(0, 8)}</Link>
                    </td>
                    <td>{r.documentDate.slice(0, 10)}</td>
                    <td>{r.priority}</td>
                    <td>{r.department?.name ?? '—'}</td>
                    <td>{r.createdByName ?? '—'}</td>
                    <td>
                      <span className={`badge badge-generic-${STATUS_CLASS[r.status] ?? 'neutral'}`}>{r.status}</span>
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

export function PurchaseRequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<Requirement | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; code: string; name: string; counterpartyType: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState('');
  const [orderQtyByLine, setOrderQtyByLine] = useState<Record<string, string>>({});
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await api.get<Requirement>(`/organizations/${orgId}/purchase-requirements/${id}`);
      setDoc(d);
      const [prods, uoms, cps] = await Promise.all([
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
        api.get<{ id: string; code: string; name: string; counterpartyType: string }[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
      ]);
      setProducts(prods);
      setUnits(uoms);
      setSuppliers(cps.filter((c) => c.counterpartyType === 'SUPPLIER' || c.counterpartyType === 'BOTH'));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!doc) return <p className="panel-note">{t.common.loading}</p>;

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/purchase-requirements/${doc.id}/cancel`, { expectedVersion: doc.version });
      showSuccess('Requirement cancelled');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (!orgId || !orderSupplierId) return;
    const allocLines = doc.lines.filter((l) => Number(orderQtyByLine[l.id] ?? 0) > 0).map((l) => ({ requirementLineId: l.id, quantity: Number(orderQtyByLine[l.id]) }));
    if (allocLines.length === 0) {
      showError(new Error('Enter a quantity for at least one line'));
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>(`/organizations/${orgId}/purchase-requirements/${doc.id}/create-order`, {
        counterpartyId: orderSupplierId,
        documentDate: new Date().toISOString().slice(0, 10),
        lines: allocLines,
      });
      showSuccess('Purchase order created');
      navigate(`/purchase-orders/${created.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{doc.number ?? doc.id}</h1>
          <div className="badge-row">
            <span className={`badge badge-generic-${STATUS_CLASS[doc.status] ?? 'neutral'}`}>{doc.status}</span>
          </div>
        </div>
        <div className="actions">
          <Link to="/purchase-requirements" className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('purchase.requirement.cancel') && doc.status !== 'CANCELLED' && doc.status !== 'CLOSED' && (
            <button className="danger" disabled={busy} onClick={cancel}>
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{t.common.documentDate}</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>Priority</dt>
          <dd>{doc.priority}</dd>
          <dt>{t.procurement.department}</dt>
          <dd>{doc.department?.name ?? '—'}</dd>
          <dt>{t.procurement.createdBy}</dt>
          <dd>{doc.createdByName ?? '—'}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>{t.common.lines}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.common.product}</th>
              <th>{t.common.unit}</th>
              <th>{t.common.quantity}</th>
              <th>Cancelled</th>
              <th>Allocate qty</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td>{products.find((p) => p.id === l.productId)?.name ?? l.productId.slice(0, 8)}</td>
                <td>{units.find((u) => u.id === l.unitId)?.code ?? l.unitId.slice(0, 8)}</td>
                <td className="numeric">{l.quantity}</td>
                <td className="numeric">{l.cancelledQuantity}</td>
                <td>
                  <input type="number" step="any" min="0" style={{ width: 90 }} value={orderQtyByLine[l.id] ?? ''} onChange={(e) => setOrderQtyByLine({ ...orderQtyByLine, [l.id]: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {hasPermission('purchase.order.create') && doc.status !== 'CANCELLED' && doc.status !== 'FULLY_ORDERED' && doc.status !== 'CLOSED' && (
        <section className="card">
          <h2>Allocate to a Purchase Order</h2>
          <p className="panel-note">Enter quantities above for the lines to allocate, pick a supplier, and create the order. Call this again with a different supplier for multi-supplier sourcing.</p>
          <div className="inline-form">
            <label>
              {t.common.supplier}
              <select value={orderSupplierId} onChange={(e) => setOrderSupplierId(e.target.value)}>
                <option value="">{t.common.select}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy || !orderSupplierId} onClick={createOrder}>
              Create purchase order
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
