import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { Cashbox, Currency } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

export function CashboxesTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [cb, curr] = await Promise.all([
        api.get<Cashbox[]>(`/organizations/${organizationId}/cashboxes`),
        api.get<Currency[]>('/currencies'),
      ]);
      setCashboxes(cb);
      setCurrencies(curr);
      if (!currencyId && curr.length > 0) setCurrencyId(curr[0].id);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const currencyCode = (id: string) => currencies.find((c) => c.id === id)?.code ?? id.slice(0, 6);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/cashboxes`, { code, name, currencyId });
      showSuccess('Cashbox created');
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

  const deactivate = async (cb: Cashbox) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/cashboxes/${cb.id}/deactivate`, { expectedVersion: cb.version });
      showSuccess('Cashbox deactivated');
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
        <h2>Cashboxes</h2>
        {hasPermission('cashbox.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New cashbox'}</button>
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
          <label>
            Currency
            <select required value={currencyId} onChange={(e) => setCurrencyId(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
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
            <th>Code</th>
            <th>Name</th>
            <th>Currency</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cashboxes.map((c) => (
            <tr key={c.id}>
              <td>{c.code}</td>
              <td>{c.name}</td>
              <td>{currencyCode(c.currencyId)}</td>
              <td>{c.active ? 'Active' : 'Inactive'}</td>
              <td>
                {c.active && hasPermission('cashbox.deactivate') && (
                  <button disabled={busy} onClick={() => deactivate(c)}>
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
