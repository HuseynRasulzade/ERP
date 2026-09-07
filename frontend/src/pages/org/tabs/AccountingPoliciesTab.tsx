import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { AccountingPolicy } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

const COSTING_METHODS = ['FIFO', 'WEIGHTED_AVERAGE'];

export function AccountingPoliciesTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [policies, setPolicies] = useState<AccountingPolicy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [inventoryCostingMethod, setInventoryCostingMethod] = useState('WEIGHTED_AVERAGE');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<AccountingPolicy[]>(`/organizations/${organizationId}/accounting-policies`).then(setPolicies).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/accounting-policies`, { code, name, validFrom, inventoryCostingMethod });
      showSuccess('Accounting policy created');
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
        <h2>Accounting policies</h2>
        {hasPermission('accounting_policy.manage') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New policy'}</button>
        )}
      </div>
      <p className="muted">
        Metadata and effective dating only — the chart of accounts and posting engine arrive in Phase 4.
      </p>
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
          <label>
            Costing method
            <select value={inventoryCostingMethod} onChange={(e) => setInventoryCostingMethod(e.target.value)}>
              {COSTING_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
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
            <th>Valid from</th>
            <th>Valid to</th>
            <th>Costing method</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.validFrom.slice(0, 10)}</td>
              <td>{p.validTo ? p.validTo.slice(0, 10) : 'Open'}</td>
              <td>{p.inventoryCostingMethod}</td>
              <td>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
