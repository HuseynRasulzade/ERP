import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, Counterparty, CounterpartyContract } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { CP_STATUS_CLASS } from './CounterpartyListPage';

type Tab = 'general' | 'addresses' | 'bank' | 'contacts' | 'contracts';

export function CounterpartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const orgId = currentOrganizationId;

  const [cp, setCp] = useState<Counterparty | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('general');

  const load = useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const data = await api.get<Counterparty>(`/organizations/${orgId}/counterparties/${id}`);
      setCp(data);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    if (!cp || !orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparties/${cp.id}/approve`, { expectedVersion: cp.version });
      showSuccess(t.counterparty.approved);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!cp) return <p className="panel-note">{t.common.loading}</p>;

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{cp.name}</h1>
          <div className="badge-row">
            <span className={`badge badge-generic-${CP_STATUS_CLASS[cp.status] ?? 'neutral'}`}>{cp.status}</span>
          </div>
        </div>
        <div className="actions">
          <Link to="/counterparties" className="link-muted">{t.common.backToList}</Link>
          {hasPermission('counterparty.approve') && (cp.status === 'DRAFT' || cp.status === 'PENDING_APPROVAL') && (
            <button className="primary" disabled={busy} onClick={approve}>{t.counterparty.approve}</button>
          )}
        </div>
      </div>

      <nav className="tab-strip">
        <button className={tab === 'general' ? 'tab active' : 'tab'} onClick={() => setTab('general')}>{t.counterparty.tabGeneral}</button>
        <button className={tab === 'addresses' ? 'tab active' : 'tab'} onClick={() => setTab('addresses')}>{t.counterparty.tabAddresses}</button>
        <button className={tab === 'bank' ? 'tab active' : 'tab'} onClick={() => setTab('bank')}>{t.counterparty.tabBankAccounts}</button>
        <button className={tab === 'contacts' ? 'tab active' : 'tab'} onClick={() => setTab('contacts')}>{t.counterparty.tabContacts}</button>
        <button className={tab === 'contracts' ? 'tab active' : 'tab'} onClick={() => setTab('contracts')}>{t.counterparty.tabContracts}</button>
      </nav>

      {tab === 'general' && <GeneralTab cp={cp} orgId={orgId} onChanged={load} />}
      {tab === 'addresses' && <AddressesTab cp={cp} orgId={orgId} onChanged={load} />}
      {tab === 'bank' && <BankAccountsTab cp={cp} orgId={orgId} onChanged={load} />}
      {tab === 'contacts' && <ContactsTab cp={cp} orgId={orgId} onChanged={load} />}
      {tab === 'contracts' && <ContractsTab cp={cp} orgId={orgId} navigate={navigate} />}
    </div>
  );
}

function GeneralTab({ cp, orgId, onChanged }: { cp: Counterparty; orgId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; fullLegalName: string; residencyStatus: string; taxId: string; foreignTaxId: string; vatPayer: string; countryCode: string; notes: string }>({
    name: cp.name, fullLegalName: cp.fullLegalName ?? '', residencyStatus: cp.residencyStatus,
    taxId: cp.taxId ?? '', foreignTaxId: cp.foreignTaxId ?? '', vatPayer: String(cp.vatPayer),
    countryCode: cp.countryCode ?? '', notes: cp.notes ?? '',
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/organizations/${orgId}/counterparties/${cp.id}`, {
        expectedVersion: cp.version,
        name: form.name, fullLegalName: form.fullLegalName || undefined, residencyStatus: form.residencyStatus,
        taxId: form.residencyStatus === 'RESIDENT' ? form.taxId || undefined : undefined,
        foreignTaxId: form.residencyStatus === 'NON_RESIDENT' ? form.foreignTaxId || undefined : undefined,
        vatPayer: form.vatPayer === '' ? undefined : form.vatPayer === 'true',
        countryCode: form.countryCode || undefined,
        notes: form.notes || undefined,
      });
      showSuccess(t.toast.updatedItem(cp.name));
      setEditing(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="card">
        <div className="inline-form">
          <label>{t.counterparty.name}<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t.counterparty.fullLegalName}<input value={form.fullLegalName} onChange={(e) => setForm({ ...form, fullLegalName: e.target.value })} /></label>
          <label>
            {t.counterparty.residency}
            <select value={form.residencyStatus} onChange={(e) => setForm({ ...form, residencyStatus: e.target.value })}>
              <option value="RESIDENT">{t.counterparty.resident}</option>
              <option value="NON_RESIDENT">{t.counterparty.nonResident}</option>
            </select>
          </label>
        </div>
        <div className="inline-form">
          {form.residencyStatus === 'RESIDENT' ? (
            <label>{t.counterparty.taxId}<input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} maxLength={10} /></label>
          ) : (
            <label>{t.counterparty.foreignTaxId}<input value={form.foreignTaxId} onChange={(e) => setForm({ ...form, foreignTaxId: e.target.value })} /></label>
          )}
          <label>
            {t.counterparty.vatPayer}
            <select value={form.vatPayer} onChange={(e) => setForm({ ...form, vatPayer: e.target.value })}>
              <option value="">{t.common.select}</option>
              <option value="true">{t.counterparty.vatPayerYes}</option>
              <option value="false">{t.counterparty.vatPayerNo}</option>
            </select>
          </label>
          <label>{t.counterparty.country}<input value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} maxLength={2} /></label>
        </div>
        <div className="inline-form">
          <label>{t.counterparty.notes}<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        </div>
        <div className="inline-form">
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
          <button type="button" onClick={() => setEditing(false)}>{t.common.cancel}</button>
        </div>
      </form>
    );
  }

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.counterparty.tabGeneral}</h2>
        {hasPermission('counterparty.edit') && <button onClick={() => setEditing(true)}>{t.counterparty.edit}</button>}
      </div>
      <dl className="kv-grid">
        <dt>{t.common.code}</dt><dd>{cp.code}</dd>
        <dt>{t.counterparty.fullLegalName}</dt><dd>{cp.fullLegalName ?? '—'}</dd>
        <dt>{t.counterparty.type}</dt><dd>{cp.counterpartyType}</dd>
        <dt>{t.counterparty.residency}</dt><dd>{cp.residencyStatus === 'RESIDENT' ? t.counterparty.resident : t.counterparty.nonResident}</dd>
        <dt>{t.counterparty.taxId}</dt><dd>{cp.taxId ?? '—'}</dd>
        <dt>{t.counterparty.foreignTaxId}</dt><dd>{cp.foreignTaxId ?? '—'}</dd>
        <dt>{t.counterparty.vatPayer}</dt><dd>{cp.vatPayer ? t.counterparty.vatPayerYes : t.counterparty.vatPayerNo}</dd>
        <dt>{t.counterparty.country}</dt><dd>{cp.countryCode ?? '—'}</dd>
        <dt>{t.counterparty.notes}</dt><dd>{cp.notes ?? '—'}</dd>
        <dt>{t.common.version}</dt><dd>{cp.version}</dd>
      </dl>
    </section>
  );
}

function AddressesTab({ cp, orgId, onChanged }: { cp: Counterparty; orgId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addressType, setAddressType] = useState('LEGAL');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [countryCode, setCountryCode] = useState('AZ');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparties/${cp.id}/addresses`, { addressType, addressLine1, city, postalCode: postalCode || undefined, countryCode });
      showSuccess(t.toast.createdItem(addressLine1));
      setAddressLine1(''); setCity(''); setPostalCode('');
      setShowForm(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.counterparty.tabAddresses}</h2>
        {hasPermission('counterparty.edit') && <button onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.counterparty.addAddress}</button>}
      </div>
      {showForm && (
        <form onSubmit={create} className="inline-form">
          <label>
            {t.counterparty.addressType}
            <select value={addressType} onChange={(e) => setAddressType(e.target.value)}>
              <option value="LEGAL">{t.counterparty.legalAddress}</option>
              <option value="ACTUAL">{t.counterparty.actualAddress}</option>
              <option value="SHIPPING">Shipping</option>
              <option value="BILLING">Billing</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>{t.counterparty.addressLine1}<input required value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} /></label>
          <label>{t.counterparty.city}<input required value={city} onChange={(e) => setCity(e.target.value)} /></label>
          <label>{t.counterparty.postalCode}<input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></label>
          <label>{t.counterparty.country}<input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} maxLength={2} /></label>
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {(cp.addresses ?? []).length === 0 ? (
        <p className="panel-note">{t.counterparty.noAddressesYet}</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>{t.counterparty.addressType}</th><th>{t.counterparty.addressLine1}</th><th>{t.counterparty.city}</th><th>{t.counterparty.country}</th></tr></thead>
          <tbody>
            {cp.addresses!.map((a) => (
              <tr key={a.id}>
                <td>{a.addressType}</td>
                <td>{a.addressLine1}</td>
                <td>{a.city}</td>
                <td>{a.countryCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BankAccountsTab({ cp, orgId, onChanged }: { cp: Counterparty; orgId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ bankName: '', bankTaxId: '', bankCode: '', accountNumber: '', iban: '', swiftBic: '', correspondentAccount: '', branchName: '', isPrimary: false });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparties/${cp.id}/bank-accounts`, {
        bankName: form.bankName, bankTaxId: form.bankTaxId || undefined, bankCode: form.bankCode || undefined,
        accountNumber: form.accountNumber, iban: form.iban || undefined, swiftBic: form.swiftBic || undefined,
        correspondentAccount: form.correspondentAccount || undefined, branchName: form.branchName || undefined, isPrimary: form.isPrimary,
      });
      showSuccess(t.toast.createdItem(form.bankName));
      setForm({ bankName: '', bankTaxId: '', bankCode: '', accountNumber: '', iban: '', swiftBic: '', correspondentAccount: '', branchName: '', isPrimary: false });
      setShowForm(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (accountId: string, expectedVersion: number) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparties/${cp.id}/bank-accounts/${accountId}/deactivate`, { expectedVersion });
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.counterparty.tabBankAccounts}</h2>
        {hasPermission('counterparty.edit') && <button onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.counterparty.addBankAccount}</button>}
      </div>
      {showForm && (
        <form onSubmit={create} className="card">
          <div className="inline-form">
            <label>{t.counterparty.bankName}<input required value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
            <label>{t.counterparty.bankTaxId}<input value={form.bankTaxId} onChange={(e) => setForm({ ...form, bankTaxId: e.target.value })} /></label>
            <label>{t.counterparty.bankCode}<input value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.accountNumber}<input required value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} /></label>
            <label>{t.counterparty.iban}<input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} /></label>
            <label>{t.counterparty.swiftBic}<input value={form.swiftBic} onChange={(e) => setForm({ ...form, swiftBic: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.correspondentAccount}<input value={form.correspondentAccount} onChange={(e) => setForm({ ...form, correspondentAccount: e.target.value })} /></label>
            <label>{t.counterparty.branchName}<input value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} /></label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
              {t.counterparty.isPrimary}
            </label>
          </div>
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {(cp.bankAccounts ?? []).length === 0 ? (
        <p className="panel-note">{t.counterparty.noBankAccountsYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.counterparty.bankName}</th><th>{t.counterparty.accountNumber}</th><th>{t.counterparty.iban}</th>
              <th>{t.counterparty.swiftBic}</th><th>{t.counterparty.isPrimary}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cp.bankAccounts!.map((a) => (
              <tr key={a.id}>
                <td>{a.bankName}</td>
                <td>{a.accountNumber}</td>
                <td>{a.iban ?? '—'}</td>
                <td>{a.swiftBic ?? '—'}</td>
                <td>{a.isPrimary ? '★' : ''}</td>
                <td>
                  {hasPermission('counterparty.edit') && (
                    <button className="small" disabled={busy} onClick={() => deactivate(a.id, a.version)}>{t.counterparty.deactivate}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ContactsTab({ cp, orgId, onChanged }: { cp: Counterparty; orgId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', position: '', department: '', phone: '', mobile: '', email: '', isPrimary: false });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparties/${cp.id}/contacts`, {
        firstName: form.firstName, lastName: form.lastName, position: form.position || undefined,
        department: form.department || undefined, phone: form.phone || undefined, mobile: form.mobile || undefined,
        email: form.email || undefined, isPrimary: form.isPrimary,
      });
      showSuccess(t.toast.createdItem(`${form.firstName} ${form.lastName}`));
      setForm({ firstName: '', lastName: '', position: '', department: '', phone: '', mobile: '', email: '', isPrimary: false });
      setShowForm(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.counterparty.tabContacts}</h2>
        {hasPermission('counterparty.edit') && <button onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.counterparty.addContact}</button>}
      </div>
      {showForm && (
        <form onSubmit={create} className="card">
          <div className="inline-form">
            <label>{t.counterparty.firstName}<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label>{t.counterparty.lastName}<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            <label>{t.counterparty.position}<input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
            <label>{t.counterparty.department}<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.phone}<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>{t.counterparty.mobile}<input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></label>
            <label>{t.counterparty.email}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
              {t.counterparty.isPrimaryContact}
            </label>
          </div>
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {(cp.contacts ?? []).length === 0 ? (
        <p className="panel-note">{t.counterparty.noContactsYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.counterparty.firstName}</th><th>{t.counterparty.position}</th><th>{t.counterparty.department}</th>
              <th>{t.counterparty.phone}</th><th>{t.counterparty.mobile}</th><th>{t.counterparty.email}</th><th>{t.counterparty.isPrimaryContact}</th>
            </tr>
          </thead>
          <tbody>
            {cp.contacts!.map((c) => (
              <tr key={c.id}>
                <td>{c.firstName} {c.lastName}</td>
                <td>{c.position ?? '—'}</td>
                <td>{c.department ?? '—'}</td>
                <td>{c.phone ?? '—'}</td>
                <td>{c.mobile ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td>{c.isPrimary ? '★' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ContractsTab({ cp, orgId, navigate }: { cp: Counterparty; orgId: string; navigate: (path: string) => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [contracts, setContracts] = useState<CounterpartyContract[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const [subject, setSubject] = useState('');
  const [eligible, setEligible] = useState<BizDoc[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.get<CounterpartyContract[]>(`/organizations/${orgId}/counterparties/${cp.id}/contracts`);
      setContracts(list);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, cp.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!showForm) return;
    api.get<BizDoc[]>(`/organizations/${orgId}/counterparties/${cp.id}/contracts/eligible-purchase-orders`)
      .then(setEligible)
      .catch((err) => showError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, orgId, cp.id]);

  // Every contract must trace back to a confirmed purchase order (spec
  // section 11: "Müqavilə formasında məcburi 'Alış sifarişini seç'
  // sahəsi olsun") — this form is the ONLY way to create a contract; the
  // generic bare-CRUD create endpoint still exists server-side but the
  // UI never calls it any more.
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<CounterpartyContract>(`/organizations/${orgId}/contracts/from-purchase-order`, { purchaseOrderId, number, subject: subject || undefined });
      showSuccess(t.toast.createdItem(number));
      setNumber(''); setSubject(''); setPurchaseOrderId('');
      setShowForm(false);
      await load();
      navigate(`/counterparties/${cp.id}/contracts/${created.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.counterparty.tabContracts}</h2>
        {hasPermission('contract.create') && <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.counterparty.addContract}</button>}
      </div>
      {showForm && (
        eligible.length === 0 ? (
          <p className="panel-note">{t.contract.noEligiblePurchaseOrders}</p>
        ) : (
          <form onSubmit={create} className="inline-form">
            <label>{t.contract.selectPurchaseOrderRequired}
              <select required value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
                <option value="">{t.common.select}</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>{o.number} — {o.grandTotal ?? ''}</option>
                ))}
              </select>
            </label>
            <label>{t.counterparty.contractNumber}<input required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <label>{t.counterparty.subject}<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
          </form>
        )
      )}
      {contracts.length === 0 ? (
        <p className="panel-note">{t.counterparty.noContractsYet}</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>{t.counterparty.contractNumber}</th><th>{t.counterparty.subject}</th><th>{t.counterparty.amount}</th><th>{t.counterparty.status}</th></tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/counterparties/${cp.id}/contracts/${c.id}`}>{c.number}</Link></td>
                <td>{c.subject}</td>
                <td className="numeric">{c.amount ?? '—'}</td>
                <td><span className={`badge badge-generic-${CP_STATUS_CLASS[c.status] ?? 'neutral'}`}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
