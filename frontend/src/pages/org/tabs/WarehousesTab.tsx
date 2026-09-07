import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { Warehouse } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

const WAREHOUSE_TYPES = ['STANDARD', 'RETAIL', 'TRANSIT', 'PRODUCTION', 'RESPONSIBLE_STORAGE'];

export function WarehousesTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [warehouseType, setWarehouseType] = useState('STANDARD');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<Warehouse[]>(`/organizations/${organizationId}/warehouses`).then(setWarehouses).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/warehouses`, { code, name, warehouseType });
      showSuccess('Warehouse created');
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

  const deactivate = async (wh: Warehouse) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/warehouses/${wh.id}/deactivate`, { expectedVersion: wh.version });
      showSuccess('Warehouse deactivated');
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
        <h2>Warehouses</h2>
        {hasPermission('warehouse.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New warehouse'}</button>
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
            Type
            <select value={warehouseType} onChange={(e) => setWarehouseType(e.target.value)}>
              {WAREHOUSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
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
            <th>Type</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((w) => (
            <tr key={w.id}>
              <td>{w.code}</td>
              <td>{w.name}</td>
              <td>{w.warehouseType}</td>
              <td>{w.active ? 'Active' : 'Inactive'}</td>
              <td>
                {w.active && hasPermission('warehouse.deactivate') && (
                  <button disabled={busy} onClick={() => deactivate(w)}>
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
