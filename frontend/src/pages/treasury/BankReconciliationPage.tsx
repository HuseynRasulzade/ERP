import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../../api/client';
import type { BankAccount } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface BankStatementLine {
  id: string;
  bankAccountId: string;
  statementDate: string;
  description: string | null;
  reference: string | null;
  amount: string;
  status: 'UNMATCHED' | 'MATCHED';
  matchedDocumentId: string | null;
  version: number;
}

interface PaymentOrder {
  id: string;
  number: string | null;
  documentDate: string;
  bankAccountId: string;
  amount: string;
  postingStatus: string;
  reconciled: boolean;
}

/** Barışdırma (Bank reconciliation) — manually-entered statement lines
 * matched against posted, not-yet-reconciled PaymentOrders. Matching
 * calls the same PaymentOrder.reconcile() the single-transaction UI
 * already used (see PaymentOrderPage's own reconciliation section) —
 * this page is the statement-driven front end for that same mechanism. */
export function BankReconciliationPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState('');
  const [matching, setMatching] = useState(false);
  const [suggestions, setSuggestions] = useState<PaymentOrder[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [editingLineId, setEditingLineId] = useState('');
  const [editStatementDate, setEditStatementDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [statementDate, setStatementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');

  const orgId = currentOrganizationId;

  const loadAccounts = useCallback(async () => {
    if (!orgId) {
      setBankAccounts([]);
      return;
    }
    try {
      const accounts = await api.get<BankAccount[]>(`/organizations/${orgId}/bank-accounts`);
      setBankAccounts(accounts.filter((a) => a.active));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const load = useCallback(async () => {
    if (!orgId || !bankAccountId) {
      setLines([]);
      setOrders([]);
      return;
    }
    setLoading(true);
    try {
      const [ln, ord] = await Promise.all([
        api.get<BankStatementLine[]>(`/organizations/${orgId}/bank-statement-lines?bankAccountId=${bankAccountId}`),
        api.get<PaymentOrder[]>(`/organizations/${orgId}/payment-orders`),
      ]);
      setLines(ln);
      setOrders(ord.filter((o) => o.bankAccountId === bankAccountId && o.postingStatus === 'POSTED' && !o.reconciled));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, bankAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !bankAccountId) return;
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/bank-statement-lines`, {
        bankAccountId,
        statementDate,
        description: description || undefined,
        reference: reference || undefined,
        amount: Number(amount),
      });
      showSuccess(t.treasury.statementLineCreated);
      setShowForm(false);
      setDescription('');
      setReference('');
      setAmount('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (line: BankStatementLine) => {
    setEditingLineId(line.id);
    setEditStatementDate(line.statementDate.slice(0, 10));
    setEditDescription(line.description ?? '');
    setEditReference(line.reference ?? '');
    setEditAmount(line.amount);
  };

  const saveEdit = async (line: BankStatementLine) => {
    setSavingEdit(true);
    try {
      await api.patch(`/organizations/${orgId}/bank-statement-lines/${line.id}`, {
        expectedVersion: line.version,
        statementDate: editStatementDate,
        description: editDescription || undefined,
        reference: editReference || undefined,
        amount: Number(editAmount),
      });
      showSuccess(t.common.save);
      setEditingLineId('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const selectLine = async (lineId: string) => {
    const next = lineId === selectedLineId ? '' : lineId;
    setSelectedLineId(next);
    setSuggestions([]);
    if (!next || !orgId) return;
    try {
      setSuggestions(await api.get<PaymentOrder[]>(`/organizations/${orgId}/bank-statement-lines/${next}/suggestions`));
    } catch (err) {
      showError(err);
    }
  };

  const onImportCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !orgId || !bankAccountId) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<{ imported: number; skipped: number; errors: { row: number; message: string }[] }>(
        `/organizations/${orgId}/bank-statement-lines/import?bankAccountId=${bankAccountId}`,
        formData,
      );
      setImportResult(result);
      showSuccess(`Imported ${result.imported}, skipped ${result.skipped}`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setImporting(false);
    }
  };

  const match = async (lineId: string, orderId: string) => {
    setMatching(true);
    try {
      await api.post(`/organizations/${orgId}/bank-statement-lines/${lineId}/match`, { documentType: 'PAYMENT_ORDER', documentId: orderId });
      showSuccess(t.treasury.matched);
      setSelectedLineId('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setMatching(false);
    }
  };

  if (!hasPermission('treasury.reconciliation.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  const unmatchedLines = lines.filter((l) => l.status === 'UNMATCHED');
  const matchedLines = lines.filter((l) => l.status === 'MATCHED');

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.reconciliation}</h1>
        {hasPermission('treasury.reconciliation.manage') && orgId && bankAccountId && (
          <div className="actions">
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" disabled={importing} onChange={onImportCsv} style={{ display: 'none' }} />
            <button disabled={importing} onClick={() => csvInputRef.current?.click()}>
              {importing ? t.common.saving : 'Import CSV…'}
            </button>
            <button className="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? t.common.cancel : `+ ${t.treasury.addStatementLine}`}
            </button>
          </div>
        )}
      </div>

      {importResult && (
        <p className="panel-note">
          Imported {importResult.imported}, skipped {importResult.skipped} duplicate(s)
          {importResult.errors.length > 0 && ` — ${importResult.errors.length} row error(s): ${importResult.errors.map((e) => `row ${e.row}: ${e.message}`).join('; ')}`}
        </p>
      )}

      <div className="inline-form">
        <label>
          {t.common.organization}
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>
              {t.common.select}
            </option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
              </option>
            ))}
          </select>
        </label>
        {orgId && (
          <label>
            {t.treasury.bankAccount}
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">{t.common.select}</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} — {a.iban}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : !bankAccountId ? (
        <p className="panel-note">{t.treasury.selectBankAccount}</p>
      ) : (
        <>
          {showForm && (
            <form onSubmit={onCreate} className="card inline-form">
              <label>
                {t.common.date}
                <input type="date" required value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
              </label>
              <label>
                {t.common.amount} ({t.treasury.signedAmountHint})
                <input type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label>
                {t.common.description}
                <input value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label>
                {t.treasury.bankReference}
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? t.common.saving : t.common.save}
              </button>
            </form>
          )}

          {loading ? (
            <p className="panel-note">{t.common.loading}</p>
          ) : (
            <>
              <section className="card">
                <h2>{t.treasury.unmatchedLines}</h2>
                {unmatchedLines.length === 0 ? (
                  <p className="panel-note">{t.treasury.noUnmatchedLines}</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t.common.date}</th>
                        <th>{t.common.description}</th>
                        <th>{t.treasury.bankReference}</th>
                        <th>{t.common.amount}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedLines.map((l) =>
                        editingLineId === l.id ? (
                          <tr key={l.id}>
                            <td>
                              <input type="date" value={editStatementDate} onChange={(e) => setEditStatementDate(e.target.value)} />
                            </td>
                            <td>
                              <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                            </td>
                            <td>
                              <input value={editReference} onChange={(e) => setEditReference(e.target.value)} />
                            </td>
                            <td>
                              <input type="number" step="any" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                            </td>
                            <td>
                              <button className="small primary" disabled={savingEdit} onClick={() => saveEdit(l)}>
                                {savingEdit ? t.common.saving : t.common.save}
                              </button>
                              <button className="small" disabled={savingEdit} onClick={() => setEditingLineId('')}>
                                {t.common.cancel}
                              </button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={l.id} style={selectedLineId === l.id ? { outline: '2px solid var(--accent, #6366f1)' } : undefined}>
                            <td>{l.statementDate.slice(0, 10)}</td>
                            <td>{l.description ?? '—'}</td>
                            <td>{l.reference ?? '—'}</td>
                            <td className="numeric">{l.amount}</td>
                            <td>
                              {hasPermission('treasury.reconciliation.manage') && (
                                <>
                                  <button className="small" disabled={matching} onClick={() => startEdit(l)}>
                                    {t.common.edit}
                                  </button>
                                  <button className="small" disabled={matching} onClick={() => selectLine(l.id)}>
                                    {selectedLineId === l.id ? t.common.cancel : t.treasury.selectToMatch}
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
              </section>

              {selectedLineId && suggestions.length > 0 && (
                <section className="card">
                  <h2>Suggested matches</h2>
                  <p className="panel-note">Posted, unreconciled payment orders on this account whose amount exactly clears this line.</p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t.common.number}</th>
                        <th>{t.common.date}</th>
                        <th>{t.common.amount}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.map((o) => (
                        <tr key={o.id}>
                          <td>{o.number ?? o.id.slice(0, 8)}</td>
                          <td>{o.documentDate.slice(0, 10)}</td>
                          <td className="numeric">{o.amount}</td>
                          <td>
                            <button className="small primary" disabled={matching} onClick={() => match(selectedLineId, o.id)}>
                              {t.treasury.match}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {selectedLineId && (
                <section className="card">
                  <h2>{t.treasury.matchToPaymentOrder}</h2>
                  {orders.length === 0 ? (
                    <p className="panel-note">{t.treasury.noUnreconciledOrders}</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t.common.number}</th>
                          <th>{t.common.date}</th>
                          <th>{t.common.amount}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td>{o.number ?? o.id.slice(0, 8)}</td>
                            <td>{o.documentDate.slice(0, 10)}</td>
                            <td className="numeric">{o.amount}</td>
                            <td>
                              <button className="small primary" disabled={matching} onClick={() => match(selectedLineId, o.id)}>
                                {t.treasury.match}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              )}

              <section className="card">
                <h2>{t.treasury.matchedLines}</h2>
                {matchedLines.length === 0 ? (
                  <p className="panel-note">{t.treasury.noMatchedLines}</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t.common.date}</th>
                        <th>{t.common.description}</th>
                        <th>{t.common.amount}</th>
                        <th>{t.treasury.matchToPaymentOrder}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedLines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.statementDate.slice(0, 10)}</td>
                          <td>{l.description ?? '—'}</td>
                          <td className="numeric">{l.amount}</td>
                          <td>{l.matchedDocumentId?.slice(0, 8) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
