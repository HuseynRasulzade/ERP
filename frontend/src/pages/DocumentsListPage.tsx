import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { FoundationTestDocument } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/**
 * Standard data table (section 50) for the demo document type. A real
 * business module (Sales, Purchase, ...) gets its own list screen shaped
 * like this one, backed by its own controller.
 */
export function DocumentsListPage() {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [documents, setDocuments] = useState<FoundationTestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.get<FoundationTestDocument[]>('/foundation-test-documents');
      setDocuments(list);
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
      await api.post('/foundation-test-documents', { documentDate, amount, description: description || undefined });
      showSuccess('Document created');
      setAmount('');
      setDescription('');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Documents</h1>
        {hasPermission('documents.create') && (
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New document'}</button>
        )}
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={onCreate}>
          <label>
            Document date
            <input type="date" required value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </label>
          <label>
            Amount
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Posting</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/documents/${d.id}`}>{d.number ?? d.id.slice(0, 8)}</Link>
                </td>
                <td>{d.documentDate.slice(0, 10)}</td>
                <td className="numeric">{d.amount}</td>
                <td>
                  <StatusBadge kind="document" value={d.status} />
                </td>
                <td>
                  <StatusBadge kind="posting" value={d.postingStatus} />
                </td>
                <td>{d.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
