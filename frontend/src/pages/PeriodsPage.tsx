import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import type { AccountingPeriod } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface PeriodReopenRequest {
  id: string;
  periodId: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  comment: string | null;
}

export function PeriodsPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [reopenRequests, setReopenRequests] = useState<PeriodReopenRequest[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await api.get<AccountingPeriod[]>('/periods');
      setPeriods(list);
      if (hasPermission('periods.reopen_request.create') || hasPermission('periods.reopen')) {
        const requests = await api.get<PeriodReopenRequest[]>('/period-reopen-requests').catch(() => []);
        setReopenRequests(requests);
      }
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

  const requestReopen = async (periodId: string) => {
    const reason = window.prompt('Reason for requesting a reopen:');
    if (!reason) return;
    setBusyId(periodId);
    try {
      await api.post('/period-reopen-requests', { periodId, reason });
      showSuccess('Reopen request filed');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const decideReopenRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setBusyId(requestId);
    try {
      await api.post(`/period-reopen-requests/${requestId}/${action}`, {});
      showSuccess(action === 'approve' ? 'Reopen request approved' : 'Reopen request rejected');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const pendingRequestFor = (periodId: string) => reopenRequests.find((r) => r.periodId === periodId && r.status === 'PENDING');

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
          {periods.map((p) => {
            const pending = pendingRequestFor(p.id);
            return (
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
                  {p.status === 'CLOSED' && !pending && !hasPermission('periods.reopen') && hasPermission('periods.reopen_request.create') && (
                    <button disabled={busyId === p.id} onClick={() => requestReopen(p.id)}>
                      Request reopen
                    </button>
                  )}
                  {pending && !hasPermission('periods.reopen') && (
                    <span className="panel-note">Reopen request pending: “{pending.reason}”</span>
                  )}
                  {pending && hasPermission('periods.reopen') && (
                    <span className="inline-form">
                      <span className="panel-note">Reopen requested: “{pending.reason}”</span>
                      <button disabled={busyId === pending.id} onClick={() => decideReopenRequest(pending.id, 'approve')}>
                        Approve
                      </button>
                      <button disabled={busyId === pending.id} className="danger" onClick={() => decideReopenRequest(pending.id, 'reject')}>
                        Reject
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
