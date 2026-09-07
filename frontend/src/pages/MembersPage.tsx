import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

interface Membership {
  id: string;
  status: string;
  user: { email: string; displayName: string };
  roles: { role: { code: string; name: string } }[];
}

export function MembersPage() {
  const { showError } = useToast();
  const [members, setMembers] = useState<Membership[]>([]);

  useEffect(() => {
    api
      .get<Membership[]>('/tenants/members')
      .then(setMembers)
      .catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Members</h1>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.user.displayName}</td>
              <td>{m.user.email}</td>
              <td>{m.status}</td>
              <td>{m.roles.map((r) => r.role.name).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
