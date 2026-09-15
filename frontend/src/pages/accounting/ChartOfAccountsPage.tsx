import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

interface Account {
  id: string;
  code: string;
  name: string;
  accountClass: string;
  normalBalance: string;
  postingAllowed: boolean;
  active: boolean;
}

export function ChartOfAccountsPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      const list = await api.get<Account[]>('/accounting/accounts');
      setAccounts(list);
    } catch (err) {
      showError(err);
      setAccounts([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = async () => {
    setAdopting(true);
    try {
      await api.post('/accounting/chart/adopt');
      // Tax localization is a separate, equally required piece of setup
      // (posting a Sales/Purchase Invoice needs a VAT rule to resolve) —
      // bundled here so "Adopt standard chart" is the one button a new
      // tenant needs before it can post anything. Idempotent, so this is
      // also safe to press again on a tenant that already has both.
      await api.post('/tax/localization/seed');
      showSuccess('Standard chart of accounts adopted and AZ VAT tax rules seeded');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setAdopting(false);
    }
  };

  const filtered = (accounts ?? []).filter(
    (a) => a.code.toLowerCase().includes(filter.toLowerCase()) || a.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Chart of Accounts</h1>
        {hasPermission('accounting.chart.manage') && (
          <button onClick={adopt} disabled={adopting}>
            {adopting ? 'Adopting…' : 'Adopt standard chart'}
          </button>
        )}
      </div>

      {accounts !== null && accounts.length === 0 && (
        <p className="empty-hint">
          No accounts yet — click <strong>Adopt standard chart</strong> to load the standard Azerbaijani chart of
          accounts for this tenant.
        </p>
      )}

      {accounts !== null && accounts.length > 0 && (
        <>
          <input
            className="table-filter"
            placeholder="Filter by code or name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Class</th>
                <th>Normal balance</th>
                <th>Postable</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td>
                  <td>{a.name}</td>
                  <td>{a.accountClass}</td>
                  <td>{a.normalBalance}</td>
                  <td>{a.postingAllowed ? 'Yes' : 'No'}</td>
                  <td>{a.active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
