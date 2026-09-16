import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Counterparty } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { exportToCsv } from '../../utils/csvExport';

const COUNTRIES = ['AZ', 'TR', 'RU', 'DE', 'GB', 'US', 'GE', 'NL', 'CN', 'AE'];

export const CP_STATUS_CLASS: Record<string, string> = {
  DRAFT: 'neutral', PENDING_APPROVAL: 'warn', APPROVED: 'ok', ACTIVE: 'ok', EXPIRED: 'bad', CANCELLED: 'bad',
};

/** "Kontragentlər" list + create (spec sections 1-2). Search/filter are
 * client-side over the org's already-loaded counterparty list — this
 * platform's org-scoped datasets are small enough that a dedicated
 * server-side search endpoint (already available at `/counterparties/
 * search` for name/code/taxId) isn't needed for the type/status facets
 * a plain array filter covers here. */
export function CounterpartyListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [items, setItems] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // -- create form state --------------------------------------------------
  const [counterpartyType, setCounterpartyType] = useState('CUSTOMER');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [fullLegalName, setFullLegalName] = useState('');
  const [residencyStatus, setResidencyStatus] = useState('RESIDENT');
  const [taxId, setTaxId] = useState('');
  const [foreignTaxId, setForeignTaxId] = useState('');
  const [vatPayer, setVatPayer] = useState('');
  const [countryCode, setCountryCode] = useState('AZ');
  const [legalAddressLine, setLegalAddressLine] = useState('');
  const [legalCity, setLegalCity] = useState('');
  const [actualAddressLine, setActualAddressLine] = useState('');
  const [actualCity, setActualCity] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.get<Counterparty[]>(`/organizations/${orgId}/counterparties`, {});
      setItems(list);
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

  const resetForm = () => {
    setCounterpartyType('CUSTOMER');
    setCode('');
    setName('');
    setFullLegalName('');
    setResidencyStatus('RESIDENT');
    setTaxId('');
    setForeignTaxId('');
    setVatPayer('');
    setCountryCode('AZ');
    setLegalAddressLine('');
    setLegalCity('');
    setActualAddressLine('');
    setActualCity('');
    setNotes('');
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const created = await api.post<Counterparty>(`/organizations/${orgId}/counterparties`, {
        counterpartyType, code, name,
        fullLegalName: fullLegalName || undefined,
        residencyStatus,
        taxId: residencyStatus === 'RESIDENT' && taxId ? taxId : undefined,
        foreignTaxId: residencyStatus === 'NON_RESIDENT' && foreignTaxId ? foreignTaxId : undefined,
        vatPayer: vatPayer ? vatPayer === 'true' : undefined,
        countryCode: countryCode || undefined,
        notes: notes || undefined,
      });

      if (legalAddressLine && legalCity) {
        await api.post(`/organizations/${orgId}/counterparties/${created.id}/addresses`, {
          addressType: 'LEGAL', addressLine1: legalAddressLine, city: legalCity, countryCode,
        });
      }
      if (actualAddressLine && actualCity) {
        await api.post(`/organizations/${orgId}/counterparties/${created.id}/addresses`, {
          addressType: 'ACTUAL', addressLine1: actualAddressLine, city: actualCity, countryCode,
        });
      }

      showSuccess(t.toast.createdItem(created.name));
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = items.filter((c) => {
    if (typeFilter && c.counterpartyType !== typeFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const haystack = `${c.name} ${c.code} ${c.taxId ?? ''} ${c.foreignTaxId ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (!hasPermission('counterparty.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.counterparty.title}</h1>
        <div className="actions">
          {filtered.length > 0 && (
            <button
              onClick={() =>
                exportToCsv(
                  t.counterparty.title,
                  [
                    { header: t.counterparty.code, value: (c: Counterparty) => c.code },
                    { header: t.common.name, value: (c: Counterparty) => c.name },
                    { header: 'Type', value: (c: Counterparty) => c.counterpartyType },
                    { header: 'Tax ID', value: (c: Counterparty) => c.taxId },
                    { header: t.common.status, value: (c: Counterparty) => c.status },
                    { header: 'Risk status', value: (c: Counterparty) => c.riskStatus },
                  ],
                  filtered,
                )
              }
            >
              {t.common.exportExcel}
            </button>
          )}
          {hasPermission('counterparty.create') && orgId && (
            <button className="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? t.common.cancel : t.counterparty.create}
            </button>
          )}
        </div>
      </div>

      <div className="inline-form">
        <label>
          {t.common.organization}
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>{t.common.select}</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
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
                  {t.common.code}
                  <input required value={code} onChange={(e) => setCode(e.target.value)} />
                </label>
                <label>
                  {t.counterparty.name}
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {t.counterparty.fullLegalName}
                  <input value={fullLegalName} onChange={(e) => setFullLegalName(e.target.value)} />
                </label>
                <label>
                  {t.counterparty.type}
                  <select value={counterpartyType} onChange={(e) => setCounterpartyType(e.target.value)}>
                    <option value="CUSTOMER">{t.counterparty.typeCustomer}</option>
                    <option value="SUPPLIER">{t.counterparty.typeSupplier}</option>
                    <option value="BOTH">{t.counterparty.typeBoth}</option>
                  </select>
                </label>
              </div>

              <div className="inline-form">
                <label>
                  {t.counterparty.residency}
                  <select value={residencyStatus} onChange={(e) => setResidencyStatus(e.target.value)}>
                    <option value="RESIDENT">{t.counterparty.resident}</option>
                    <option value="NON_RESIDENT">{t.counterparty.nonResident}</option>
                  </select>
                </label>
                {residencyStatus === 'RESIDENT' ? (
                  <label>
                    {t.counterparty.taxId}
                    <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder={t.counterparty.taxIdHint} maxLength={10} />
                  </label>
                ) : (
                  <label>
                    {t.counterparty.foreignTaxId}
                    <input value={foreignTaxId} onChange={(e) => setForeignTaxId(e.target.value)} />
                  </label>
                )}
                <label>
                  {t.counterparty.vatPayer}
                  <select value={vatPayer} onChange={(e) => setVatPayer(e.target.value)}>
                    <option value="">{t.common.select}</option>
                    <option value="true">{t.counterparty.vatPayerYes}</option>
                    <option value="false">{t.counterparty.vatPayerNo}</option>
                  </select>
                </label>
                <label>
                  {t.counterparty.country}
                  <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="inline-form">
                <label>
                  {t.counterparty.legalAddress}
                  <input value={legalAddressLine} onChange={(e) => setLegalAddressLine(e.target.value)} placeholder={t.counterparty.addressLine1} />
                </label>
                <label>
                  {t.counterparty.city}
                  <input value={legalCity} onChange={(e) => setLegalCity(e.target.value)} />
                </label>
              </div>
              <div className="inline-form">
                <label>
                  {t.counterparty.actualAddress}
                  <input value={actualAddressLine} onChange={(e) => setActualAddressLine(e.target.value)} placeholder={t.counterparty.addressLine1} />
                </label>
                <label>
                  {t.counterparty.city}
                  <input value={actualCity} onChange={(e) => setActualCity(e.target.value)} />
                </label>
              </div>

              <div className="inline-form">
                <label>
                  {t.counterparty.notes}
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>

              <div className="inline-form">
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          )}

          <div className="inline-form">
            <label>
              {t.counterparty.search}
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.counterparty.search} />
            </label>
            <label>
              {t.counterparty.filterType}
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">{t.counterparty.allTypes}</option>
                <option value="CUSTOMER">{t.counterparty.typeCustomer}</option>
                <option value="SUPPLIER">{t.counterparty.typeSupplier}</option>
                <option value="BOTH">{t.counterparty.typeBoth}</option>
              </select>
            </label>
            <label>
              {t.counterparty.filterStatus}
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t.counterparty.allStatuses}</option>
                {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : filtered.length === 0 ? (
            <p className="panel-note">{t.counterparty.noResults}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.counterparty.name}</th>
                  <th>{t.counterparty.taxId}</th>
                  <th>{t.counterparty.residency}</th>
                  <th>{t.counterparty.vatPayer}</th>
                  <th>{t.counterparty.primaryContact}</th>
                  <th>{t.counterparty.phone}</th>
                  <th>{t.counterparty.status}</th>
                  <th>{t.counterparty.createdDate}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const primaryContact = c.contacts?.[0];
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/counterparties/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>{c.taxId ?? c.foreignTaxId ?? '—'}</td>
                      <td>{c.residencyStatus === 'RESIDENT' ? t.counterparty.resident : t.counterparty.nonResident}</td>
                      <td>{c.vatPayer ? t.counterparty.vatPayerYes : t.counterparty.vatPayerNo}</td>
                      <td>{primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : '—'}</td>
                      <td>{primaryContact?.phone ?? c.phone ?? '—'}</td>
                      <td>
                        <span className={`badge badge-generic-${CP_STATUS_CLASS[c.status] ?? 'neutral'}`}>{c.status}</span>
                      </td>
                      <td>{c.createdAt?.slice(0, 10)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
