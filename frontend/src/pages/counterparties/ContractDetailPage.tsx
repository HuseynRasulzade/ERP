import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CounterpartyContract, CounterpartyContractAmendment } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { CP_STATUS_CLASS } from './CounterpartyListPage';
import { DocumentManager } from './DocumentManager';

export function ContractDetailPage() {
  const { id: counterpartyId, contractId } = useParams<{ id: string; contractId: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [contract, setContract] = useState<CounterpartyContract | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    subject: '', contractType: '', signedDate: '', startDate: '', endDate: '',
    amount: '', currencyId: '', paymentTerms: '', responsiblePersonId: '',
  });

  const load = useCallback(async () => {
    if (!orgId || !contractId) return;
    try {
      const data = await api.get<CounterpartyContract>(`/organizations/${orgId}/contracts/${contractId}`);
      setContract(data);
      setForm({
        subject: data.subject, contractType: data.contractType ?? '',
        signedDate: data.signedDate?.slice(0, 10) ?? '', startDate: data.startDate?.slice(0, 10) ?? '', endDate: data.endDate?.slice(0, 10) ?? '',
        amount: data.amount ?? '', currencyId: data.currencyId ?? '', paymentTerms: data.paymentTerms ?? '', responsiblePersonId: data.responsiblePersonId ?? '',
      });
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!contract || !orgId) return;
    setBusy(true);
    try {
      await api.patch(`/organizations/${orgId}/contracts/${contract.id}`, {
        expectedVersion: contract.version,
        subject: form.subject, contractType: form.contractType || undefined,
        signedDate: form.signedDate || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined,
        amount: form.amount ? Number(form.amount) : undefined, currencyId: form.currencyId || undefined,
        paymentTerms: form.paymentTerms || undefined, responsiblePersonId: form.responsiblePersonId || undefined,
      });
      showSuccess(t.toast.updatedItem(contract.number));
      setEditing(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!contract || !orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contract.id}/approve`, { expectedVersion: contract.version });
      showSuccess(t.contract.approved);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!contract) return <p className="panel-note">{t.common.loading}</p>;

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{contract.number} — {contract.subject}</h1>
          <div className="badge-row">
            <span className={`badge badge-generic-${CP_STATUS_CLASS[contract.status] ?? 'neutral'}`}>{contract.status}</span>
          </div>
        </div>
        <div className="actions">
          <Link to={`/counterparties/${counterpartyId}`} className="link-muted">{t.contract.backToCounterparty}</Link>
          {hasPermission('contract.edit') && !editing && <button onClick={() => setEditing(true)}>{t.counterparty.edit}</button>}
          {hasPermission('contract.approve') && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && (
            <button className="primary" disabled={busy} onClick={approve}>{t.contract.approve}</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="card">
          <div className="inline-form">
            <label>{t.counterparty.subject}<input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label>{t.counterparty.contractType}<input value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })} placeholder="e.g. SUPPLY, SERVICE, LEASE" /></label>
            <label>{t.counterparty.responsiblePerson}<input value={form.responsiblePersonId} onChange={(e) => setForm({ ...form, responsiblePersonId: e.target.value })} placeholder="responsible person id" /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.signedDate}<input type="date" value={form.signedDate} onChange={(e) => setForm({ ...form, signedDate: e.target.value })} /></label>
            <label>{t.counterparty.startDate}<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
            <label>{t.counterparty.endDate}<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.amount}<input type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>{t.counterparty.currency}<input value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })} placeholder="currency id" /></label>
            <label>{t.counterparty.paymentTerms}<input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. NET 30" /></label>
          </div>
          <div className="inline-form">
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{t.common.cancel}</button>
          </div>
        </form>
      ) : (
        <section className="card">
          <dl className="kv-grid">
            <dt>{t.counterparty.contractType}</dt><dd>{contract.contractType ?? '—'}</dd>
            <dt>{t.counterparty.signedDate}</dt><dd>{contract.signedDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.startDate}</dt><dd>{contract.startDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.endDate}</dt><dd>{contract.endDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.amount}</dt><dd className="numeric">{contract.amount ?? '—'}</dd>
            <dt>{t.counterparty.paymentTerms}</dt><dd>{contract.paymentTerms ?? '—'}</dd>
            <dt>{t.counterparty.responsiblePerson}</dt><dd>{contract.responsiblePersonId ?? '—'}</dd>
            <dt>{t.common.version}</dt><dd>{contract.version}</dd>
          </dl>
        </section>
      )}

      <section className="card">
        <DocumentManager orgId={orgId} ownerType="CONTRACT" ownerId={contract.id} />
      </section>

      <section className="card">
        <AmendmentsSection orgId={orgId} contractId={contract.id} onChanged={load} />
      </section>
    </div>
  );
}

function AmendmentsSection({ orgId, contractId, onChanged }: { orgId: string; contractId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [amendments, setAmendments] = useState<CounterpartyContractAmendment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const [subject, setSubject] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.get<CounterpartyContractAmendment[]>(`/organizations/${orgId}/contracts/${contractId}/amendments`);
      setAmendments(list);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contractId}/amendments`, { number, subject });
      showSuccess(t.toast.createdItem(number));
      setNumber(''); setSubject('');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t.contract.amendments}</h2>
        {hasPermission('contract.amendment.create') && <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.contract.addAmendment}</button>}
      </div>
      {showForm && (
        <form onSubmit={create} className="inline-form">
          <label>{t.contract.amendmentNumber}<input required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
          <label>{t.counterparty.subject}<input required value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {amendments.length === 0 ? (
        <p className="panel-note">{t.contract.noAmendmentsYet}</p>
      ) : (
        amendments.map((a) => <AmendmentCard key={a.id} orgId={orgId} amendment={a} onChanged={() => { load(); onChanged(); }} />)
      )}
    </div>
  );
}

function AmendmentCard({ orgId, amendment, onChanged }: { orgId: string; amendment: CounterpartyContractAmendment; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    subject: amendment.subject, amendmentDate: amendment.amendmentDate?.slice(0, 10) ?? '',
    effectiveDate: amendment.effectiveDate?.slice(0, 10) ?? '', endDate: amendment.endDate?.slice(0, 10) ?? '',
    newAmount: amendment.newAmount ?? '', currencyId: amendment.currencyId ?? '', changeDescription: amendment.changeDescription ?? '',
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/organizations/${orgId}/contract-amendments/${amendment.id}`, {
        expectedVersion: amendment.version,
        subject: form.subject, amendmentDate: form.amendmentDate || undefined, effectiveDate: form.effectiveDate || undefined,
        endDate: form.endDate || undefined, newAmount: form.newAmount ? Number(form.newAmount) : undefined,
        currencyId: form.currencyId || undefined, changeDescription: form.changeDescription || undefined,
      });
      showSuccess(t.toast.updatedItem(amendment.number));
      setEditing(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contract-amendments/${amendment.id}/approve`, { expectedVersion: amendment.version });
      showSuccess(t.contract.approved);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: '0.75rem' }}>
      <div className="page-header">
        <h3>{amendment.number} — {amendment.subject}</h3>
        <div className="actions">
          <span className={`badge badge-generic-${CP_STATUS_CLASS[amendment.status] ?? 'neutral'}`}>{amendment.status}</span>
          {hasPermission('contract.amendment.edit') && !editing && <button className="small" onClick={() => setEditing(true)}>{t.counterparty.edit}</button>}
          {hasPermission('contract.amendment.approve') && (amendment.status === 'DRAFT' || amendment.status === 'PENDING_APPROVAL') && (
            <button className="small primary" disabled={busy} onClick={approve}>{t.contract.approve}</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save}>
          <div className="inline-form">
            <label>{t.counterparty.subject}<input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label>{t.contract.amendmentDate}<input type="date" value={form.amendmentDate} onChange={(e) => setForm({ ...form, amendmentDate: e.target.value })} /></label>
            <label>{t.contract.effectiveDate}<input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></label>
            <label>{t.contract.endDate}<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.contract.newAmount}<input type="number" step="any" value={form.newAmount} onChange={(e) => setForm({ ...form, newAmount: e.target.value })} /></label>
            <label>{t.counterparty.currency}<input value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })} placeholder="currency id" /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.changeDescription}<input value={form.changeDescription} onChange={(e) => setForm({ ...form, changeDescription: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{t.common.cancel}</button>
          </div>
        </form>
      ) : (
        <dl className="kv-grid">
          <dt>{t.contract.amendmentDate}</dt><dd>{amendment.amendmentDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.effectiveDate}</dt><dd>{amendment.effectiveDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.endDate}</dt><dd>{amendment.endDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.newAmount}</dt><dd className="numeric">{amendment.newAmount ?? '—'}</dd>
          <dt>{t.contract.changeDescription}</dt><dd>{amendment.changeDescription ?? '—'}</dd>
        </dl>
      )}

      <DocumentManager orgId={orgId} ownerType="CONTRACT_AMENDMENT" ownerId={amendment.id} />
    </div>
  );
}
