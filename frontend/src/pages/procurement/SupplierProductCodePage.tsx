import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { SalesCounterpartyRef, SalesProductRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Mapping {
  id: string;
  counterpartyId: string;
  productId: string;
  supplierCode: string;
  moq: string | null;
  orderMultiple: string | null;
  leadTimeDays: number | null;
  active: boolean;
}

/** Phase 8 — flat CRUD mapping (no document lifecycle: no post/unpost,
 * just create + deactivate), so this page skips the generic Doc*
 * components entirely. */
export function SupplierProductCodePage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<Mapping[]>([]);
  const [suppliers, setSuppliers] = useState<SalesCounterpartyRef[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [productId, setProductId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [moq, setMoq] = useState('');
  const [orderMultiple, setOrderMultiple] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [maps, cps, prods] = await Promise.all([
        api.get<Mapping[]>(`/organizations/${orgId}/supplier-product-codes`),
        api.get<SalesCounterpartyRef[]>(`/organizations/${orgId}/counterparties`).catch(() => []),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
      ]);
      setItems(maps);
      setSuppliers(cps.filter((c) => c.counterpartyType === 'SUPPLIER' || c.counterpartyType === 'BOTH'));
      setProducts(prods);
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
      await api.post(`/organizations/${orgId}/supplier-product-codes`, {
        counterpartyId,
        productId,
        supplierCode,
        moq: moq ? Number(moq) : undefined,
        orderMultiple: orderMultiple ? Number(orderMultiple) : undefined,
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
      });
      showSuccess('Mapping saved');
      setSupplierCode('');
      setMoq('');
      setOrderMultiple('');
      setLeadTimeDays('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('purchase.supplier_product_code.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.supplierProductCodes}</h1>
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
          {hasPermission('purchase.supplier_product_code.manage') && (
            <form onSubmit={onCreate} className="inline-form">
              <label>
                {t.common.supplier}
                <select required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                  <option value="" disabled>
                    {t.common.select}
                  </option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.common.product}
                <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
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
                Supplier code
                <input required value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} />
              </label>
              <label>
                MOQ
                <input type="number" step="any" min="0" value={moq} onChange={(e) => setMoq(e.target.value)} />
              </label>
              <label>
                Order multiple
                <input type="number" step="any" min="0" value={orderMultiple} onChange={(e) => setOrderMultiple(e.target.value)} />
              </label>
              <label>
                Lead time (days)
                <input type="number" min="0" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
              </label>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? t.common.saving : t.common.save}
              </button>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="panel-note">No supplier product codes yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.common.supplier}</th>
                  <th>{t.common.product}</th>
                  <th>Supplier code</th>
                  <th>MOQ</th>
                  <th>Order multiple</th>
                  <th>Lead time</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td>{suppliers.find((s) => s.id === m.counterpartyId)?.name ?? m.counterpartyId.slice(0, 8)}</td>
                    <td>{products.find((p) => p.id === m.productId)?.name ?? m.productId.slice(0, 8)}</td>
                    <td className="mono">{m.supplierCode}</td>
                    <td className="numeric">{m.moq ?? '—'}</td>
                    <td className="numeric">{m.orderMultiple ?? '—'}</td>
                    <td className="numeric">{m.leadTimeDays ?? '—'}</td>
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
