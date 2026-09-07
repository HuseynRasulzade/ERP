import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { Organization } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

export function GeneralTab({ org, onChanged }: { org: Organization; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: org.name,
    fullLegalName: org.fullLegalName ?? '',
    shortName: org.shortName ?? '',
    legalForm: org.legalForm ?? '',
    taxId: org.taxId ?? '',
    registrationNumber: org.registrationNumber ?? '',
    registeredAddress: org.registeredAddress ?? '',
    actualAddress: org.actualAddress ?? '',
    phone: org.phone ?? '',
    email: org.email ?? '',
    website: org.website ?? '',
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/organizations/${org.id}`, { ...form, expectedVersion: org.version });
      showSuccess('Organization updated');
      setEditing(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      const action = org.active ? 'deactivate' : 'reactivate';
      await api.post(`/organizations/${org.id}/${action}`, { expectedVersion: org.version });
      showSuccess(org.active ? 'Organization deactivated' : 'Organization reactivated');
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="card">
        <h2>General</h2>
        <dl className="kv-grid">
          <dt>Code</dt>
          <dd>{org.code}</dd>
          <dt>Name</dt>
          <dd>{org.name}</dd>
          <dt>Full legal name</dt>
          <dd>{org.fullLegalName ?? '—'}</dd>
          <dt>Legal form</dt>
          <dd>{org.legalForm ?? '—'}</dd>
          <dt>Tax ID</dt>
          <dd>{org.taxId ?? '—'}</dd>
          <dt>Registration No.</dt>
          <dd>{org.registrationNumber ?? '—'}</dd>
          <dt>Country</dt>
          <dd>{org.countryCode}</dd>
          <dt>Registered address</dt>
          <dd>{org.registeredAddress ?? '—'}</dd>
          <dt>Actual address</dt>
          <dd>{org.actualAddress ?? '—'}</dd>
          <dt>Phone</dt>
          <dd>{org.phone ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{org.email ?? '—'}</dd>
          <dt>Website</dt>
          <dd>{org.website ?? '—'}</dd>
          <dt>Status</dt>
          <dd>{org.active ? 'Active' : 'Inactive'}</dd>
        </dl>
        <div className="actions">
          {hasPermission('organization.edit') && <button onClick={() => setEditing(true)}>Edit</button>}
          {hasPermission('organization.deactivate') && (
            <button disabled={busy} className={org.active ? 'danger' : ''} onClick={toggleActive}>
              {org.active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Edit organization</h2>
      <div className="form-grid">
        <label>
          Name
          <input value={form.name} onChange={set('name')} />
        </label>
        <label>
          Full legal name
          <input value={form.fullLegalName} onChange={set('fullLegalName')} />
        </label>
        <label>
          Short name
          <input value={form.shortName} onChange={set('shortName')} />
        </label>
        <label>
          Legal form
          <input value={form.legalForm} onChange={set('legalForm')} />
        </label>
        <label>
          Tax ID (VÖEN)
          <input value={form.taxId} onChange={set('taxId')} />
        </label>
        <label>
          Registration number
          <input value={form.registrationNumber} onChange={set('registrationNumber')} />
        </label>
        <label>
          Registered address
          <input value={form.registeredAddress} onChange={set('registeredAddress')} />
        </label>
        <label>
          Actual address
          <input value={form.actualAddress} onChange={set('actualAddress')} />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={set('phone')} />
        </label>
        <label>
          Email
          <input value={form.email} onChange={set('email')} />
        </label>
        <label>
          Website
          <input value={form.website} onChange={set('website')} />
        </label>
      </div>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
