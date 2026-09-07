import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AuditEvent } from '../api/types';
import { useToast } from '../context/ToastContext';

export function AuditPage() {
  const { showError } = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    api
      .get<AuditEvent[]>('/audit-events')
      .then(setEvents)
      .catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Audit log</h1>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Entity</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.timestamp).toLocaleString()}</td>
              <td>{e.eventType}</td>
              <td>
                {e.entityType} · {e.entityId.slice(0, 8)}
              </td>
              <td>{e.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
