import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import type { AccountingPeriod } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function PeriodsPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await api.get<AccountingPeriod[]>('/periods');
      setPeriods(list);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/periods', { year, month });
      showSuccess('Period created');
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const close = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/periods/${id}/close`);
      showSuccess('Period closed');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (id: string) => {
    const reason = window.prompt('Reason for reopening (optional):') ?? undefined;
    setBusyId(id);
    try {
      await api.post(`/periods/${id}/reopen`, { reason });
      showSuccess('Period reopened');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Accounting periods</h1>
      </div>

      {hasPermission('periods.view') && (
        <form className="inline-form" onSubmit={onCreate}>
          <label>
            Year
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </label>
          <label>
            Month
            <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </label>
          <button type="submit">Create period</button>
        </form>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Range</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td>
                {p.year}-{String(p.month).padStart(2, '0')}
              </td>
              <td>
                {p.startDate.slice(0, 10)} → {p.endDate.slice(0, 10)}
              </td>
              <td>
                <StatusBadge kind="period" value={p.status} />
              </td>
              <td>
                {p.status === 'OPEN' && hasPermission('periods.close') && (
                  <button disabled={busyId === p.id} onClick={() => close(p.id)}>
                    Close
                  </button>
                )}
                {p.status === 'CLOSED' && hasPermission('periods.reopen') && (
                  <button disabled={busyId === p.id} onClick={() => reopen(p.id)}>
                    Reopen
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
