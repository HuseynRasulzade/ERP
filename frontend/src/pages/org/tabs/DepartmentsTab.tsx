import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { Department } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

/** Section 50: departments shown as an indented tree built client-side from
 * the flat parentDepartmentId list the API returns. */
function buildTree(departments: Department[]): (Department & { depth: number })[] {
  const byParent = new Map<string | null, Department[]>();
  for (const d of departments) {
    const key = d.parentDepartmentId;
    byParent.set(key, [...(byParent.get(key) ?? []), d]);
  }
  const result: (Department & { depth: number })[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const d of byParent.get(parentId) ?? []) {
      result.push({ ...d, depth });
      visit(d.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export function DepartmentsTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentDepartmentId, setParentDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<Department[]>(`/organizations/${organizationId}/departments`).then(setDepartments).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const tree = useMemo(() => buildTree(departments), [departments]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/departments`, {
        code,
        name,
        parentDepartmentId: parentDepartmentId || undefined,
      });
      showSuccess('Department created');
      setCode('');
      setName('');
      setParentDepartmentId('');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (dept: Department) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/departments/${dept.id}/deactivate`, {
        expectedVersion: dept.version,
      });
      showSuccess('Department deactivated');
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
        <h2>Departments</h2>
        {hasPermission('department.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New department'}</button>
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
            Parent department
            <select value={parentDepartmentId} onChange={(e) => setParentDepartmentId(e.target.value)}>
              <option value="">— none (top level) —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
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
            <th>Code</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tree.map((d) => (
            <tr key={d.id}>
              <td style={{ paddingLeft: 14 + d.depth * 20 }}>{d.depth > 0 ? '↳ ' : ''}{d.name}</td>
              <td>{d.code}</td>
              <td>{d.active ? 'Active' : 'Inactive'}</td>
              <td>
                {d.active && hasPermission('department.deactivate') && (
                  <button disabled={busy} onClick={() => deactivate(d)}>
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
