import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import type { Permission, Role } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function RolesPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const [r, p] = await Promise.all([
        api.get<Role[]>('/roles'),
        api.get<Permission[]>('/permissions'),
      ]);
      setRoles(r);
      setPermissions(p);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (code: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/roles', { code, name, permissionCodes: Array.from(selected) });
      showSuccess('Role created');
      setCode('');
      setName('');
      setSelected(new Set());
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const grouped = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <h1>Roles &amp; permissions</h1>
        {hasPermission('core.roles.manage') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New role'}</button>
        )}
      </div>

      {showForm && (
        <form className="card" onSubmit={onCreate}>
          <label>
            Code
            <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="AUDITOR" />
          </label>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Auditor" />
          </label>
          <fieldset>
            <legend>Permissions</legend>
            {Object.entries(grouped).map(([module, perms]) => (
              <div key={module} className="permission-group">
                <strong>{module}</strong>
                {perms.map((p) => (
                  <label key={p.code} className="checkbox-row">
                    <input type="checkbox" checked={selected.has(p.code)} onChange={() => toggle(p.code)} />
                    {p.code}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <button type="submit">Create role</button>
        </form>
      )}

      <div className="role-list">
        {roles.map((r) => (
          <div key={r.id} className="card">
            <h2>
              {r.name} <span className="muted">({r.code})</span>
              {r.isSystem && <span className="badge badge-system">system</span>}
            </h2>
            <div className="chip-row">
              {r.permissions.map((rp) => (
                <span key={rp.permission.code} className="chip">
                  {rp.permission.code}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
