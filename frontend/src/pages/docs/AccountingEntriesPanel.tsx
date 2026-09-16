import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface AccountingMovementLine {
  id: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: string;
  description: string | null;
  account: { code: string; name: string };
}

interface JournalEntryGroup {
  journalEntry: { id: string; journalNumber: string; businessDate: string; description: string | null; status: string } | null;
  lines: AccountingMovementLine[];
}

/** "Mühasibat yazılışlarına bax" — a reusable "Accounting entries" panel,
 * usable from any document page (DocDetailPage-driven or bespoke) since
 * every document type may post through a different route but the
 * underlying query (GET .../accounting/journal-entries?sourceDocumentType=
 * &sourceDocumentId=) is fully generic — same shape as ApprovalStepsPanel/
 * document-links. Renders nothing for a document type/permission that has
 * no entries (never posted, or posting has no GL consequence). */
export function AccountingEntriesPanel({
  orgId,
  documentType,
  documentId,
  title = 'Accounting entries',
}: {
  orgId: string;
  documentType: string;
  documentId: string;
  title?: string;
}) {
  const { hasPermission } = useAuth();
  const [groups, setGroups] = useState<JournalEntryGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const canView = hasPermission('accounting.journal.view');

  const load = useCallback(async () => {
    if (!canView) return;
    const rows = await api
      .get<JournalEntryGroup[]>(`/organizations/${orgId}/accounting/journal-entries?sourceDocumentType=${documentType}&sourceDocumentId=${documentId}`)
      .catch(() => []);
    setGroups(rows);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, documentType, documentId, canView]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView || !loaded || groups.length === 0) return null;

  return (
    <section className="card">
      <h2>{title}</h2>
      {groups.map((g) => (
        <div key={g.journalEntry?.id ?? Math.random()} style={{ marginBottom: '1rem' }}>
          <div className="panel-note">
            {g.journalEntry?.journalNumber} · {g.journalEntry?.businessDate?.slice(0, 10)} · {g.journalEntry?.status}
            {g.journalEntry?.description ? ` — ${g.journalEntry.description}` : ''}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.account.code} — {l.account.name}</td>
                  <td className="numeric">{l.side === 'DEBIT' ? l.amountBase : ''}</td>
                  <td className="numeric">{l.side === 'CREDIT' ? l.amountBase : ''}</td>
                  <td>{l.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
