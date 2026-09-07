import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { Branch } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

export function BranchesTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get<Branch[]>(`/organizations/${organizationId}/branches`).then(setBranches).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/branches`, { code, name });
      showSuccess('Branch created');
      setCode('');
      setName('');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (branch: Branch) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/branches/${branch.id}/deactivate`, {
        expectedVersion: branch.version,
      });
      showSuccess('Branch deactivated');
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
        <h2>Branches</h2>
        {hasPermission('branch.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New branch'}</button>
        )}
      </div>
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
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.id}>
              <td>{b.code}</td>
              <td>{b.name}</td>
              <td>{b.active ? 'Active' : 'Inactive'}</td>
              <td>
                {b.active && hasPermission('branch.deactivate') && (
                  <button disabled={busy} onClick={() => deactivate(b)}>
                    Deactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
