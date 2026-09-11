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
      showSuccess(`Tenant "${tenant.name}" created — you are its Tenant Administrator.`);
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
