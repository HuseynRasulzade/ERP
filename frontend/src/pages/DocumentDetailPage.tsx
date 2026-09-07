import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditEvent, DocumentLink, FoundationTestDocument } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DOC_TYPE = 'FOUNDATION_TEST_DOCUMENT';

/**
 * Document header + status badges + post/unpost/cancel actions + generic
 * audit metadata + document-link area (section 50). Every action sends the
 * `version` the client last saw — the framework rejects it as a
 * CONCURRENCY_CONFLICT if it's stale (section 14/62), which the ToastContext
 * surfaces distinctly rather than as a generic failure.
 */
export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [doc, setDoc] = useState<FoundationTestDocument | null>(null);
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [d, l] = await Promise.all([
        api.get<FoundationTestDocument>(`/foundation-test-documents/${id}`),
        api.get<DocumentLink[]>(`/document-links?documentType=${DOC_TYPE}&documentId=${id}`),
      ]);
      setDoc(d);
      setLinks(l);
      setEditAmount(d.amount);
      setEditDescription(d.description ?? '');
      if (hasPermission('audit.view')) {
        const audit = await api.get<AuditEvent[]>(`/audit-events?entityType=${DOC_TYPE}&entityId=${id}`);
        setAuditEvents(audit);
      }
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!doc) return <p className="muted">Loading…</p>;

  const runCommand = async (command: 'post' | 'unpost' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/documents/${DOC_TYPE}/${doc.id}/${command}`, { expectedVersion: doc.version });
      showSuccess(`Document ${command}ed`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await api.patch(`/foundation-test-documents/${doc.id}`, {
        amount: editAmount,
        description: editDescription || undefined,
        expectedVersion: doc.version,
      });
      showSuccess('Document updated');
      setEditing(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const createBasedOn = async () => {
    setBusy(true);
    try {
      const target = await api.post<FoundationTestDocument>(
        `/documents/${DOC_TYPE}/${doc.id}/create-based-on/${DOC_TYPE}`,
        {},
      );
      showSuccess('Follow-up document created');
      navigate(`/documents/${target.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const canEdit = hasPermission('documents.edit') && doc.postingStatus !== 'POSTED';

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{doc.number ?? doc.id}</h1>
          <div className="badge-row">
            <StatusBadge kind="document" value={doc.status} />
            <StatusBadge kind="posting" value={doc.postingStatus} />
          </div>
        </div>
        <div className="actions">
          {hasPermission('documents.post') && doc.postingStatus === 'NOT_POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} onClick={() => runCommand('post')}>
              Post
            </button>
          )}
          {hasPermission('documents.unpost') && doc.postingStatus === 'POSTED' && (
            <button disabled={busy} onClick={() => runCommand('unpost')}>
              Unpost
            </button>
          )}
          {hasPermission('documents.cancel') && doc.postingStatus !== 'POSTED' && doc.status !== 'CANCELLED' && (
            <button disabled={busy} className="danger" onClick={() => runCommand('cancel')}>
              Cancel
            </button>
          )}
          {hasPermission('documents.create') && (
            <button disabled={busy} onClick={createBasedOn}>
              Create based on…
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <h2>Header</h2>
        <dl className="kv-grid">
          <dt>Document date</dt>
          <dd>{doc.documentDate.slice(0, 10)}</dd>
          <dt>Posted at</dt>
          <dd>{doc.postedAt ?? '—'}</dd>
          <dt>Amount</dt>
          <dd className="numeric">{doc.amount}</dd>
          <dt>Description</dt>
          <dd>{doc.description ?? '—'}</dd>
          <dt>Version</dt>
          <dd>{doc.version}</dd>
        </dl>

        {canEdit && (
          <>
            {!editing ? (
              <button onClick={() => setEditing(true)}>Edit</button>
            ) : (
              <div className="inline-form">
                <label>
                  Amount
                  <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                </label>
                <label>
                  Description
                  <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                </label>
                <button disabled={busy} onClick={saveEdit}>
                  Save
                </button>
                <button disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Document links</h2>
        {links.length === 0 ? (
          <p className="muted">No related documents.</p>
        ) : (
          <ul className="link-list">
            {links.map((l) => {
              const isSource = l.sourceDocumentId === doc.id;
              const otherId = isSource ? l.targetDocumentId : l.sourceDocumentId;
              return (
                <li key={l.id}>
                  <span className="relation-type">{l.relationType}</span>{' '}
                  {isSource ? '→' : '←'} <Link to={`/documents/${otherId}`}>{otherId.slice(0, 8)}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {hasPermission('audit.view') && (
        <section className="card">
          <h2>Audit trail</h2>
          {auditEvents.length === 0 ? (
            <p className="muted">No audit events.</p>
          ) : (
            <ul className="audit-list">
              {auditEvents.map((e) => (
                <li key={e.id}>
                  <span className="audit-event-type">{e.eventType}</span>
                  <span className="muted"> {new Date(e.timestamp).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
