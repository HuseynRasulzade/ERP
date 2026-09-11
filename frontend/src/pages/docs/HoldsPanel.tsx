import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Hold {
  id: string;
  holdType: string;
  reason: string | null;
  status: string;
  placedAt: string;
  releasedAt: string | null;
}

/** Reusable structured-hold widget (spec: never just a comment) shared by
 * Sales Order and Purchase Order detail pages — place/release, nothing
 * more. `basePath` is the doc's own holds route
 * (`purchase-orders/:id/holds`); `releasePath` is the header-less release
 * endpoint (`purchase-order-holds`). */
export function HoldsPanel({ docBasePath, docId, releaseBasePath, holdTypes, permission }: { docBasePath: string; docId: string; releaseBasePath: string; holdTypes: string[]; permission: string }) {
  const { currentOrganizationId } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [holdType, setHoldType] = useState(holdTypes[0] ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setHolds(await api.get<Hold[]>(`/organizations/${orgId}/${docBasePath}/${docId}/holds`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, docBasePath, docId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasPermission(permission)) return null;

  const place = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/${docBasePath}/${docId}/holds`, { holdType, reason: reason || undefined });
      showSuccess('Hold placed');
      setReason('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const release = async (holdId: string) => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/${releaseBasePath}/${holdId}/release`, {});
      showSuccess('Hold released');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Holds</h2>
      {holds.length === 0 ? (
        <p className="panel-note">No holds.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>{t.common.reason}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {holds.map((h) => (
              <tr key={h.id}>
                <td className="mono">{h.holdType}</td>
                <td>{h.reason ?? '—'}</td>
                <td>{h.status}</td>
                <td>
                  {h.status === 'ACTIVE' && (
                    <button className="small" disabled={busy} onClick={() => release(h.id)}>
                      Release
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="inline-form" style={{ marginTop: 14 }}>
        <label>
          Type
          <select value={holdType} onChange={(e) => setHoldType(e.target.value)}>
            {holdTypes.map((ht) => (
              <option key={ht} value={ht}>
                {ht}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.common.reason}
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="small" disabled={busy} onClick={place}>
          Place hold
        </button>
      </div>
    </section>
  );
}
