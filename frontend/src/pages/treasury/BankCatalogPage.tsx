import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Bank } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

/** Bank (institution) catalog — 1C's "Банки" directory, tenant-wide and
 * separate from an organization's own BankAccount rows. Mirrors
 * ProductCatalogPage's UnitsTab pattern exactly (a plain tenant-scoped
 * catalog: code/name/deactivate). */
export function BankCatalogPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [banks, setBanks] = useState<Bank[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [swiftBic, setSwiftBic] = useState('');
  const [correspondentAccount, setCorrespondentAccount] = useState('');
  const [address, setAddress] = useState('');

  const load = () => api.get<Bank[]>('/banks').then(setBanks).catch(showError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post<Bank>('/banks', {
        code,
        name,
        swiftBic: swiftBic || undefined,
        correspondentAccount: correspondentAccount || undefined,
        address: address || undefined,
      });
      showSuccess(`Bank created: ${code}`);
      setCode('');
      setName('');
      setSwiftBic('');
      setCorrespondentAccount('');
      setAddress('');
      setShowForm(false);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (b: Bank) => {
    setBusy(true);
    try {
      await api.post(`/banks/${b.id}/deactivate`, { expectedVersion: b.version });
      showSuccess(`Deactivated: ${b.name}`);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Banks</h1>
        {hasPermission('bank.create') && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New bank'}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={create} className="card">
          <div className="inline-form">
            <label>
              Code
              <input required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              Name
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              SWIFT/BIC
              <input value={swiftBic} onChange={(e) => setSwiftBic(e.target.value.toUpperCase())} />
            </label>
            <label>
              Correspondent account
              <input value={correspondentAccount} onChange={(e) => setCorrespondentAccount(e.target.value)} />
            </label>
            <label>
              Address
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {banks.length === 0 ? (
        <p className="panel-note">No banks yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>SWIFT/BIC</th>
              <th>Correspondent account</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {banks.map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td>{b.name}</td>
                <td>{b.swiftBic ?? '—'}</td>
                <td>{b.correspondentAccount ?? '—'}</td>
                <td>{b.active ? 'Active' : 'Inactive'}</td>
                <td>
                  {b.active && hasPermission('bank.deactivate') && (
                    <button className="small" disabled={busy} onClick={() => deactivate(b)}>
                      Deactivate
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
