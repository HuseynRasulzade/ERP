import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { OrganizationAccessGrant } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

interface Membership {
  id: string;
  user: { email: string; displayName: string };
}

/** Section 22: explicit per-organization access grants. */
export function AccessTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [grants, setGrants] = useState<OrganizationAccessGrant[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [membershipId, setMembershipId] = useState('');
  const [accessLevel, setAccessLevel] = useState('FULL');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [g, m] = await Promise.all([
        api.get<OrganizationAccessGrant[]>(`/organizations/${organizationId}/access`),
        api.get<Membership[]>('/tenants/members'),
      ]);
      setGrants(g);
      setMembers(m);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    if (!membershipId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/access`, { membershipId, accessLevel });
      showSuccess('Access granted');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (mId: string) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/access/${mId}/revoke`);
      showSuccess('Access revoked');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission('organization_access.manage')) {
    return <p className="muted">You don't have permission to manage organization access.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Organization access</h2>
      </div>
      <p className="muted">
        A tenant membership does not automatically see this organization — access must be explicitly granted.
      </p>
      <form className="inline-form" onSubmit={grant}>
        <label>
          Member
          <select required value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.displayName} ({m.user.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          Access level
          <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}>
            <option value="FULL">Full</option>
            <option value="READ">Read only</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          Grant access
        </button>
      </form>
      <table className="data-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Access level</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {grants.map((g) => (
            <tr key={g.id}>
              <td>{g.membership ? `${g.membership.user.displayName} (${g.membership.user.email})` : g.tenantMembershipId}</td>
              <td>{g.accessLevel}</td>
              <td>
                <button disabled={busy} onClick={() => revoke(g.tenantMembershipId)}>
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
