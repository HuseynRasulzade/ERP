import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { TaxCategory, TaxMovement, TaxRate, TaxRegisterSummary, TaxRegistration, TaxRule, TaxType } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

type Tab = 'config' | 'registrations' | 'register';

/** Tax Engine admin UI — read-only config lists (types/rates/categories/
 * rules are system-seeded, no create/edit endpoints exist for them),
 * per-organization tax registrations (create + list), and the tax
 * register ledger report. Mirrors AccountingReportsPage's tab-strip
 * pattern, since the underlying backend (tax-engine module) was already
 * complete — only the frontend was missing. */
export function TaxEnginePage() {
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>('config');
  const orgId = currentOrganizationId;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.taxEngine}</h1>
      </div>

      <nav className="tab-strip">
        <button className={tab === 'config' ? 'tab active' : 'tab'} onClick={() => setTab('config')}>
          {t.tax.config}
        </button>
        {orgId && (
          <button className={tab === 'registrations' ? 'tab active' : 'tab'} onClick={() => setTab('registrations')}>
            {t.tax.registrations}
          </button>
        )}
        {orgId && (
          <button className={tab === 'register' ? 'tab active' : 'tab'} onClick={() => setTab('register')}>
            {t.tax.register}
          </button>
        )}
      </nav>

      {tab === 'config' && <ConfigTab />}
      {tab === 'registrations' && orgId && hasPermission('tax.registration.view') && <RegistrationsTab orgId={orgId} />}
      {tab === 'register' && orgId && hasPermission('tax.register.view') && <RegisterTab orgId={orgId} />}
      {tab !== 'config' && !orgId && <p className="panel-note">{t.common.selectOrganization}</p>}
    </div>
  );
}

function ConfigTab() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [types, setTypes] = useState<TaxType[]>([]);
  const [categories, setCategories] = useState<TaxCategory[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ty, cat, ra, ru] = await Promise.all([
        api.get<TaxType[]>('/tax/types').catch(() => []),
        hasPermission('tax.category.view') ? api.get<TaxCategory[]>('/tax/categories').catch(() => []) : Promise.resolve([]),
        hasPermission('tax.rate.view') ? api.get<TaxRate[]>('/tax/rates').catch(() => []) : Promise.resolve([]),
        hasPermission('tax.rule.view') ? api.get<TaxRule[]>('/tax/rules').catch(() => []) : Promise.resolve([]),
      ]);
      setTypes(ty);
      setCategories(cat);
      setRates(ra);
      setRules(ru);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/tax/localization/seed', {});
      showSuccess(t.tax.seedLocalization);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) return <p className="panel-note">{t.common.loading}</p>;

  if (types.length === 0) {
    return (
      <div className="card">
        <p className="panel-note">{t.tax.noConfigYet}</p>
        {hasPermission('tax.config.view') && (
          <button className="primary" disabled={seeding} onClick={seed}>
            {seeding ? t.common.saving : t.tax.seedLocalization}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <section className="card">
        <h2>{t.tax.types}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.common.code}</th>
              <th>{t.common.name}</th>
              <th>{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {types.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.active ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {hasPermission('tax.category.view') && (
        <section className="card">
          <h2>{t.tax.categories}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.code}</th>
                <th>{t.common.name}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.active ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hasPermission('tax.rate.view') && (
        <section className="card">
          <h2>{t.tax.rates}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.tax.types}</th>
                <th>{t.common.code}</th>
                <th>{t.tax.jurisdiction}</th>
                <th>{t.tax.rate}</th>
                <th>{t.tax.rateType}</th>
                <th>{t.tax.effectiveFrom}</th>
                <th>{t.tax.effectiveTo}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td>{r.taxType?.code ?? r.taxTypeId.slice(0, 8)}</td>
                  <td>{r.code}</td>
                  <td>{r.jurisdiction}</td>
                  <td className="numeric">{r.rate}%</td>
                  <td>{r.rateType}</td>
                  <td>{r.effectiveFrom.slice(0, 10)}</td>
                  <td>{r.effectiveTo ? r.effectiveTo.slice(0, 10) : '—'}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hasPermission('tax.rule.view') && (
        <section className="card">
          <h2>{t.tax.rules}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.code}</th>
                <th>{t.common.name}</th>
                <th>{t.tax.types}</th>
                <th>{t.tax.treatment}</th>
                <th>{t.tax.priority}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.taxType?.code ?? types.find((ty) => ty.id === r.taxTypeId)?.code ?? r.taxTypeId.slice(0, 8)}</td>
                  <td>{r.treatment}</td>
                  <td className="numeric">{r.priority}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function RegistrationsTab({ orgId }: { orgId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<TaxRegistration[]>([]);
  const [types, setTypes] = useState<TaxType[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [taxType, setTaxType] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState('');
  const [status, setStatus] = useState('REGISTERED');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [regs, ty] = await Promise.all([
        api.get<TaxRegistration[]>(`/organizations/${orgId}/tax-registrations`),
        api.get<TaxType[]>('/tax/types').catch(() => []),
      ]);
      setItems(regs);
      setTypes(ty);
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
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/tax-registrations`, {
        taxType,
        registrationNumber: registrationNumber || undefined,
        validFrom,
        validTo: validTo || undefined,
        status,
      });
      showSuccess(t.toast.createdItem(taxType));
      setShowForm(false);
      setRegistrationNumber('');
      setValidTo('');
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
        <h2>{t.tax.registrations}</h2>
        {hasPermission('tax.registration.manage') && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.common.cancel : t.tax.newRegistration}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="card inline-form">
          <label>
            {t.tax.types}
            <select required value={taxType} onChange={(e) => setTaxType(e.target.value)}>
              <option value="" disabled>
                {t.common.select}
              </option>
              {types.map((ty) => (
                <option key={ty.id} value={ty.code}>
                  {ty.code} — {ty.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.tax.registrationNumber}
            <input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
          </label>
          <label>
            {t.tax.validFrom}
            <input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label>
            {t.tax.validTo}
            <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
          <label>
            {t.common.status}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="REGISTERED">REGISTERED</option>
              <option value="NOT_REGISTERED">NOT_REGISTERED</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? t.common.saving : t.common.save}
          </button>
        </form>
      )}

      {loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="panel-note">{t.tax.noRegistrationsYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.tax.types}</th>
              <th>{t.tax.registrationNumber}</th>
              <th>{t.tax.jurisdiction}</th>
              <th>{t.tax.validFrom}</th>
              <th>{t.tax.validTo}</th>
              <th>{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.taxType}</td>
                <td>{r.registrationNumber ?? '—'}</td>
                <td>{r.jurisdiction}</td>
                <td>{r.validFrom.slice(0, 10)}</td>
                <td>{r.validTo ? r.validTo.slice(0, 10) : '—'}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function defaultFromDate() {
  return new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

function RegisterTab({ orgId }: { orgId: string }) {
  const { showError } = useToast();
  const { t } = useLocale();

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [rows, setRows] = useState<TaxMovement[]>([]);
  const [summary, setSummary] = useState<TaxRegisterSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ fromDate, toDate });
      const [movements, sum] = await Promise.all([
        api.get<TaxMovement[]>(`/organizations/${orgId}/tax/register?${qs}`),
        api.get<TaxRegisterSummary>(`/organizations/${orgId}/tax/register/summary?${qs}`),
      ]);
      setRows(movements);
      setSummary(sum);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="inline-form">
        <label>
          {t.accounting.fromDate}
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          {t.accounting.toDate}
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <button className="primary" disabled={loading} onClick={run}>
          {loading ? t.common.loading : t.accounting.runReport}
        </button>
      </div>

      {summary && (
        <section className="card">
          <dl className="kv-grid">
            <dt>{t.tax.taxableBase}</dt>
            <dd className="numeric">{summary.taxableBase}</dd>
            <dt>{t.tax.taxAmount}</dt>
            <dd className="numeric">{summary.taxAmount}</dd>
            <dt>{t.tax.recoverable}</dt>
            <dd className="numeric">{summary.recoverableAmount}</dd>
            <dt>{t.tax.nonrecoverable}</dt>
            <dd className="numeric">{summary.nonrecoverableAmount}</dd>
            <dt>{t.tax.movementCount}</dt>
            <dd className="numeric">{summary.movementCount}</dd>
          </dl>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="panel-note">{t.tax.noMovementsYet}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.tax.types}</th>
                <th>{t.common.code}</th>
                <th>{t.tax.direction}</th>
                <th>{t.tax.taxableBase}</th>
                <th>{t.tax.taxAmount}</th>
                <th>{t.accounting.sourceDocument}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.taxPointDate.slice(0, 10)}</td>
                  <td>{m.taxType}</td>
                  <td>{m.taxCode}</td>
                  <td>{m.direction}</td>
                  <td className="numeric">{m.taxableBase}</td>
                  <td className="numeric">{m.taxAmount}</td>
                  <td>{m.sourceDocumentType ? `${m.sourceDocumentType} · ${m.sourceDocumentId?.slice(0, 8)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
