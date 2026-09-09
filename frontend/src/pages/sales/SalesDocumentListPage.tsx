import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type {
  SalesCounterpartyRef,
  SalesLineDraft,
  SalesOrder,
  SalesProductRef,
  SalesUnitRef,
} from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { emptyLine, SalesLinesEditor, serializeLines, counterpartyName } from './SalesLinesEditor';

export type SalesKind = 'order' | 'invoice';

const KIND_CONFIG = {
  order: {
    title: 'Sales orders',
    basePath: 'sales-orders',
    routePrefix: 'sales-orders',
    viewPerm: 'sales_order.view',
    createPerm: 'sales_order.create',
    emptyHint: 'No sales orders yet.',
  },
  invoice: {
    title: 'Sales invoices',
    basePath: 'sales-invoices',
    routePrefix: 'sales-invoices',
    viewPerm: 'sales_invoice.view',
    createPerm: 'sales_invoice.create',
    emptyHint: 'No sales invoices yet.',
  },
} as const;

/**
 * Phase 4 — org-scoped list + create screen for sales orders/invoices,
 * shaped like DocumentsListPage. Prices snapshot at SAVE: a blank line
 * price resolves from the SALE price list, an entered price overrides it.
 */
export function SalesDocumentListPage({ kind }: { kind: SalesKind }) {
  const cfg = KIND_CONFIG[kind];
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();

  const [documents, setDocuments] = useState<SalesOrder[]>([]);
  const [counterparties, setCounterparties] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [priceIncludesTax, setPriceIncludesTax] = useState(false);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<SalesLineDraft[]>([emptyLine()]);

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const [docs, cps, prods, uoms] = await Promise.all([
        api.get<SalesOrder[]>(`/organizations/${orgId}/${cfg.basePath}`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setDocuments(docs);
      setCounterparties(cps.filter((c) => c.counterpartyType === 'CUSTOMER' || c.counterpartyType === 'BOTH'));
      setProducts(prods);
      setUnits(uoms);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, cfg.basePath]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (lines.some((l) => !l.productId || !l.unitId)) {
      showError(new Error('Every line needs a product and a unit'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<SalesOrder>(`/organizations/${orgId}/${cfg.basePath}`, {
        counterpartyId,
        documentDate,
        priceIncludesTax,
        description: description || undefined,
        lines: serializeLines(lines),
      });
      showSuccess(`Created ${created.number ?? created.id.slice(0, 8)}`);
      setCounterpartyId('');
      setDescription('');
      setLines([emptyLine()]);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission(cfg.viewPerm)) {
    return <p className="muted">You don&apos;t have permission to view {cfg.title.toLowerCase()}.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{cfg.title}</h1>
        {hasPermission(cfg.createPerm) && orgId && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : `+ New ${kind}`}</button>
        )}
      </div>

      <div className="inline-form">
        <label>
          Organization
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>
              Select…
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
        <p className="muted">Select an organization to continue.</p>
      ) : (
        <>
          {showForm && (
            <form onSubmit={onCreate}>
              <div className="inline-form">
                <label>
                  Customer
                  <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="" disabled>
                      Select…
                    </option>
                    {counterparties.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Document date
                  <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={priceIncludesTax}
                    onChange={(e) => setPriceIncludesTax(e.target.checked)}
                  />
                  Prices include tax
                </label>
                <label>
                  Description
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>
              <SalesLinesEditor lines={lines} setLines={setLines} products={products} units={units} />
              <div className="inline-form">
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="muted">Loading…</p>
          ) : documents.length === 0 ? (
            <p className="muted">{cfg.emptyHint}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Subtotal</th>
                  <th>Tax</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Posting</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/${cfg.routePrefix}/${d.id}`}>{d.number ?? d.id.slice(0, 8)}</Link>
                    </td>
                    <td>{d.documentDate.slice(0, 10)}</td>
                    <td>{counterpartyName(counterparties, d.counterpartyId)}</td>
                    <td className="numeric">{d.subtotal}</td>
                    <td className="numeric">{d.taxTotal}</td>
                    <td className="numeric">{d.grandTotal}</td>
                    <td>
                      <StatusBadge kind="document" value={d.status} />
                    </td>
                    <td>
                      <StatusBadge kind="posting" value={d.postingStatus} />
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
