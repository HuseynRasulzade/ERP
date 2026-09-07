import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../api/client';
import type { BankAccount, Currency } from '../../../api/types';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';

/** Section 53: mask all but the last 4 characters in the list view. */
function maskIban(iban: string) {
  if (iban.length <= 4) return iban;
  return `${'•'.repeat(iban.length - 4)}${iban.slice(-4)}`;
}

export function BankAccountsTab({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [iban, setIban] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [accs, curr] = await Promise.all([
        api.get<BankAccount[]>(`/organizations/${organizationId}/bank-accounts`),
        api.get<Currency[]>('/currencies'),
      ]);
      setAccounts(accs);
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
      await api.post(`/organizations/${organizationId}/bank-accounts`, {
        bankName,
        accountName,
        iban,
        currencyId,
        isDefault,
      });
      showSuccess('Bank account created');
      setBankName('');
      setAccountName('');
      setIban('');
      setIsDefault(false);
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (acc: BankAccount) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${organizationId}/bank-accounts/${acc.id}/deactivate`, {
        expectedVersion: acc.version,
      });
      showSuccess('Bank account closed');
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
        <h2>Bank accounts</h2>
        {hasPermission('bank_account.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New bank account'}</button>
        )}
      </div>
      {showForm && (
        <form className="inline-form" onSubmit={create}>
          <label>
            Bank name
            <input required value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </label>
          <label>
            Account name
            <input required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </label>
          <label>
            IBAN
            <input required value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="AZ.." />
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
          <label className="checkbox-row">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Default account
          </label>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>Bank</th>
            <th>Account name</th>
            <th>IBAN</th>
            <th>Currency</th>
            <th>Default</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.bankName}</td>
              <td>{a.accountName}</td>
              <td className="numeric" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {maskIban(a.iban)}
              </td>
              <td>{currencyCode(a.currencyId)}</td>
              <td>{a.isDefault ? '★' : ''}</td>
              <td>{a.active ? 'Active' : 'Closed'}</td>
              <td>
                {a.active && hasPermission('bank_account.deactivate') && (
                  <button disabled={busy} onClick={() => deactivate(a)}>
                    Close
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
