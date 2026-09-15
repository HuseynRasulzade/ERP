import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Tenant } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function NewTenantPage() {
  const { refreshTenants, selectTenant } = useAuth();
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tenant = await api.post<Tenant>('/tenants', { code, name });
      await refreshTenants();
      await selectTenant(tenant.id);

      // Bootstrap the two pieces of shared reference data every tenant
      // needs before it can post anything: the standard chart of
      // accounts and the AZ VAT tax localization. Both are idempotent —
      // safe even if a later phase or another admin already ran them.
      try {
        await api.post('/accounting/chart/adopt');
      } catch {
        /* non-fatal — visible later via the Chart of Accounts page's own "Adopt" button */
      }
      try {
        await api.post('/tax/localization/seed');
      } catch {
        /* non-fatal — Tax Engine setup can be retried from the tax config screens */
      }

      showSuccess(`Tenant "${tenant.name}" created — you are its Tenant Administrator. Standard chart of accounts and AZ VAT tax rules were set up automatically.`);
      navigate('/sales-orders');
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>New tenant</h1>
        <p className="muted">
          A tenant is an isolated workspace. Creating one makes you its Tenant Administrator.
        </p>
        <label>
          Code
          <input
            required
            pattern="[a-z0-9-]{2,32}"
            title="lowercase letters, digits, hyphens"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="acme"
          />
        </label>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create tenant'}
        </button>
      </form>
    </div>
  );
}
