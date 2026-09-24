import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

export interface ResponsiblePerson {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  notes: string | null;
  active: boolean;
  version: number;
}

/** Phase 1 - Responsible Person catalog (spec section 10/44): tenant-global,
 * not every responsible person is a system user (userId is optional), so
 * this is its own flat CRUD catalog rather than an org-membership picker. */
export function ResponsiblePersonPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<ResponsiblePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.get<ResponsiblePerson[]>('/responsible-persons?includeInactive=true');
      setItems(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/responsible-persons', {
        displayName,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
      });
      showSuccess('Saved');
      setDisplayName('');
      setEmail('');
      setPhone('');
      setNotes('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onDeactivate = async (p: ResponsiblePerson) => {
    try {
      await api.post(`/responsible-persons/${p.id}/deactivate`, { expectedVersion: p.version });
      showSuccess('Saved');
      await load();
    } catch (err) {
      showError(err);
    }
  };

  if (!hasPermission('responsible_person.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.responsiblePersons}</h1>
      </div>

      {hasPermission('responsible_person.manage') && (
        <form onSubmit={onCreate} className="inline-form">
          <label>
            {t.common.name}
            <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? t.common.saving : t.common.save}
          </button>
        </form>
      )}

      {loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="panel-note">No responsible persons yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.common.name}</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Notes</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>{p.email ?? '-'}</td>
                <td>{p.phone ?? '-'}</td>
                <td>{p.notes ?? '-'}</td>
                <td>
                  <span className={`badge badge-generic-${p.active ? 'success' : 'neutral'}`}>{p.active ? 'ACTIVE' : 'INACTIVE'}</span>
                </td>
                <td>
                  {p.active && hasPermission('responsible_person.manage') && (
                    <button type="button" onClick={() => onDeactivate(p)}>
                      {t.counterparty.deactivate}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
