import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Organization } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';

/** Organization list + create (section 3, UI section 49). */
export function OrganizationsPage() {
  const { hasPermission } = useAuth();
  const { organizations, loading, refresh } = useOrganization();
  const { showError, showSuccess } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('AZ');
  const [submitting, setSubmitting] = useState(false);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const org = await api.post<Organization>('/organizations', { code, name, countryCode });
      showSuccess(`Organization "${org.name}" created`);
      setCode('');
      setName('');
      setShowForm(false);
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Organizations</h1>
        {hasPermission('organization.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New organization'}</button>
        )}
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={onCreate}>
          <label>
            Code
            <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="sinteks" />
          </label>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="SINTEKS MMC" />
          </label>
          <label>
            Country
            <input value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} maxLength={2} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : organizations.length === 0 ? (
        <p className="muted">No organizations yet — create one to get started.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Legal name</th>
              <th>Country</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/organizations/${o.id}`}>{o.code}</Link>
                </td>
                <td>{o.name}</td>
                <td>{o.fullLegalName ?? '—'}</td>
                <td>{o.countryCode}</td>
                <td>{o.active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
