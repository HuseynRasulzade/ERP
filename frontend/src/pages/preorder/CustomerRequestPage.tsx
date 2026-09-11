import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, SalesCounterpartyRef, SalesProductRef, SalesUnitRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface CRLine {
  productId: string;
  unitId: string;
  quantity: string;
}

export function CustomerRequestListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<BizDoc[]>([]);
  const [customers, setCustomers] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<CRLine[]>([{ productId: '', unitId: '', quantity: '1' }]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [reqs, cps, prods, uoms] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/customer-requests`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setItems(reqs);
      setCustomers(cps.filter((c) => c.counterpartyType === 'CUSTOMER' || c.counterpartyType === 'BOTH'));
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

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<BizDoc>(`/organizations/${orgId}/customer-requests`, {
        counterpartyId,
        documentDate,
        lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity })),
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

  if (!hasPermission('sales.customer_request.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.customerRequests}</h1>
        {hasPermission('sales.customer_request.create') && orgId && (
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
                  {t.common.customer}
                  <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="" disabled>
                      {t.common.select}
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.common.documentDate}
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
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
            <p className="panel-note">No customer requests yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{t.common.customer}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/customer-requests/${r.id}`}>{r.number ?? r.id.slice(0, 8)}</Link>
                    </td>
                    <td>{r.documentDate.slice(0, 10)}</td>
                    <td>{customers.find((c) => c.id === r.counterpartyId)?.name ?? '—'}</td>
                    <td>
                      <span className="badge">{String(r.status)}</span>
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

export function CustomerRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<BizDoc | null>(null);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      setDoc(await api.get<BizDoc>(`/organizations/${orgId}/customer-requests/${id}`));
      const [prods, uoms] = await Promise.all([api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []), api.get<SalesUnitRef[]>('/units-of-measure').catch(() => [])]);
      setProducts(prods);
      setUnits(uoms);
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
      await api.post(`/organizations/${orgId}/customer-requests/${doc.id}/cancel`, { expectedVersion: doc.version });
      showSuccess('Request cancelled');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createOffer = async () => {
    setBusy(true);
    try {
      const created = await api.post<BizDoc>(`/documents/CUSTOMER_REQUEST/${doc.id}/create-based-on/COMMERCIAL_OFFER`, {});
      navigate(`/commercial-offers/${created.id}`);
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
            <span className="badge">{String(doc.status)}</span>
          </div>
        </div>
        <div className="actions">
          <Link to="/customer-requests" className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('sales.customer_request.cancel') && (doc.status as string) === 'OPEN' && (
            <button className="danger" disabled={busy} onClick={cancel}>
              {t.common.cancel}
            </button>
          )}
          {hasPermission('sales.offer.create') && (doc.status as string) === 'OPEN' && (
            <button className="primary" disabled={busy} onClick={createOffer}>
              Create offer…
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.lines}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.common.product}</th>
              <th>{t.common.unit}</th>
              <th>{t.common.quantity}</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines ?? []).map((l, i) => (
              <tr key={l.id ?? i}>
                <td>{products.find((p) => p.id === l.productId)?.name ?? l.productId}</td>
                <td>{units.find((u) => u.id === l.unitId)?.code ?? l.unitId}</td>
                <td className="numeric">{l.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
