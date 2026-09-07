import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { TaxProfile } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

export function TaxProfilesTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [profiles, setProfiles] = useState<TaxProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [vatRegistered, setVatRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<TaxProfile[]>(`/organizations/${organizationId}/tax-profiles`).then(setProfiles).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/tax-profiles`, { code, name, validFrom, vatRegistered });
      showSuccess('Tax profile created');
      setCode('');
      setName('');
      setValidFrom('');
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
        <h2>Tax profiles</h2>
        {hasPermission('tax_profile.manage') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New tax profile'}</button>
        )}
      </div>
      <p className="muted">Tax identity/registration only — VAT rates and calculation arrive in Phase 5.</p>
      {showForm && (
        <form className="inline-form" onSubmit={create}>
          <label>
            Code
            <input required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Valid from
            <input required type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={vatRegistered} onChange={(e) => setVatRegistered(e.target.checked)} />
            VAT registered
          </label>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Tax ID</th>
            <th>VAT registered</th>
            <th>Valid from</th>
            <th>Valid to</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.taxId ?? '—'}</td>
              <td>{p.vatRegistered ? 'Yes' : 'No'}</td>
              <td>{p.validFrom.slice(0, 10)}</td>
              <td>{p.validTo ? p.validTo.slice(0, 10) : 'Open'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
