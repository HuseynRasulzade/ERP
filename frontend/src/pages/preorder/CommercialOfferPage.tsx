import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, LineDraft, SalesCounterpartyRef, SalesProductRef, SalesUnitRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { DocLinesEditor, emptyDocLine, serializeDocLines } from '../docs/DocLinesEditor';

export function CommercialOfferListPage() {
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
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyDocLine()]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [offers, cps, prods, uoms] = await Promise.all([
        api.get<BizDoc[]>(`/organizations/${orgId}/commercial-offers`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setItems(offers);
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
      const created = await api.post<BizDoc>(`/organizations/${orgId}/commercial-offers`, {
        counterpartyId,
        documentDate,
        validUntil: validUntil || undefined,
        lines: serializeDocLines(lines),
      });
      showSuccess(t.toast.createdItem(created.number ?? created.id.slice(0, 8)));
      setLines([emptyDocLine()]);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('sales.offer.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.commercialOffers}</h1>
        {hasPermission('sales.offer.create') && orgId && (
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
                <label>
                  Valid until
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </label>
              </div>
              <DocLinesEditor lines={lines} setLines={setLines} products={products} units={units} priceHint="auto from SALE price list" />
              <div className="inline-form">
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="panel-note">No commercial offers yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.number}</th>
                  <th>{t.common.date}</th>
                  <th>{t.common.customer}</th>
                  <th>{t.common.grandTotal}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/commercial-offers/${r.id}`}>{r.number ?? r.id.slice(0, 8)}</Link>
                    </td>
                    <td>{r.documentDate.slice(0, 10)}</td>
                    <td>{customers.find((c) => c.id === r.counterpartyId)?.name ?? '—'}</td>
                    <td className="numeric">{r.grandTotal ?? '—'}</td>
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

export function CommercialOfferDetailPage() {
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
      setDoc(await api.get<BizDoc>(`/organizations/${orgId}/commercial-offers/${id}`));
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

  const action = async (path: string, label: string) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/commercial-offers/${doc.id}/${path}`, { expectedVersion: doc.version });
      showSuccess(label);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    setBusy(true);
    try {
      const created = await api.post<BizDoc>(`/documents/COMMERCIAL_OFFER/${doc.id}/create-based-on/SALES_ORDER`, {});
      navigate(`/sales-orders/${created.id}`);
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
          <Link to="/commercial-offers" className="link-muted">
            {t.common.backToList}
          </Link>
          {hasPermission('sales.offer.send') && (doc.status as string) === 'DRAFT' && (
            <button disabled={busy} onClick={() => action('send', 'Offer sent')}>
              Send
            </button>
          )}
          {hasPermission('sales.offer.accept') && (doc.status as string) === 'SENT' && (
            <button className="primary" disabled={busy} onClick={() => action('accept', 'Offer accepted')}>
              Accept
            </button>
          )}
          {hasPermission('sales.offer.accept') && (doc.status as string) === 'SENT' && (
            <button className="danger" disabled={busy} onClick={() => action('reject', 'Offer rejected')}>
              Reject
            </button>
          )}
          {hasPermission('sales.offer.cancel') && (doc.status as string) !== 'CANCELLED' && (doc.status as string) !== 'ACCEPTED' && (
            <button className="danger" disabled={busy} onClick={() => action('cancel', 'Offer cancelled')}>
              {t.common.cancel}
            </button>
          )}
          {hasPermission('sales.offer.convert') && (doc.status as string) === 'ACCEPTED' && (
            <button className="primary" disabled={busy} onClick={createOrder}>
              Create order…
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>{t.common.header}</h2>
        <dl className="kv-grid">
          <dt>{t.common.subtotal}</dt>
          <dd className="numeric">{doc.subtotal ?? '—'}</dd>
          <dt>{t.common.taxTotal}</dt>
          <dd className="numeric">{doc.taxTotal ?? '—'}</dd>
          <dt>{t.common.grandTotal}</dt>
          <dd className="numeric">{doc.grandTotal ?? '—'}</dd>
          <dt>Valid until</dt>
          <dd>{(doc.validUntil as string | undefined)?.slice(0, 10) ?? '—'}</dd>
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
              <th>{t.common.price}</th>
              <th>{t.common.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines ?? []).map((l, i) => (
              <tr key={l.id ?? i}>
                <td>{products.find((p) => p.id === l.productId)?.name ?? l.productId}</td>
                <td>{units.find((u) => u.id === l.unitId)?.code ?? l.unitId}</td>
                <td className="numeric">{l.quantity}</td>
                <td className="numeric">{l.price}</td>
                <td className="numeric">{l.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
