import { Fragment, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

interface Account {
  id: string;
  code: string;
  name: string;
  postingAllowed: boolean;
  active: boolean;
}

interface JournalLine {
  id: string;
  sequence: number;
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: string;
  description: string | null;
}

interface ManualOperation {
  id: string;
  journalNumber: string;
  businessDate: string;
  description: string | null;
  status: string;
  isManual: boolean;
  version: number;
  lines?: JournalLine[];
}

interface DraftDimension {
  dimensionCode: string;
  referenceId: string;
}

interface DraftLine {
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: string;
  description: string;
  dimensions: DraftDimension[];
}

interface CurrencyRef {
  id: string;
  code: string;
}

/** Subconto/dimension codes an Account can require before it accepts a
 * posting (backend/src/accounting-core/accounting-dimension-codes.ts
 * DimensionCodes) — the backend rejects a line with ACCOUNT_DIMENSION_REQUIRED
 * if a required one is missing, so this UI must be able to supply any of them. */
const DIMENSION_CODES = [
  'ORGANIZATION', 'BRANCH', 'DEPARTMENT', 'WAREHOUSE', 'CASHBOX', 'BANK_ACCOUNT',
  'PARTNER', 'COUNTERPARTY', 'CONTRACT', 'AGREEMENT', 'PRODUCT', 'PRODUCT_CHARACTERISTIC',
  'CURRENCY', 'SETTLEMENT_DOCUMENT',
];

/** Phase 4 — Manual accounting operations (spec section ~36-38): lets an
 * accountant post an arbitrary balanced journal entry not tied to a
 * business document. Backed by the same JournalEntry/JournalEntryLine
 * model as every other posting handler, flagged isManual=true. */
export function ManualOperationListPage() {
  const { hasPermission } = useAuth();
  const { organizations, currentOrganizationId, selectOrganization } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();

  const [items, setItems] = useState<ManualOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const list = await api.get<ManualOperation[]>(`/organizations/${orgId}/manual-operations`);
      setItems(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasPermission('accounting.manual_operation.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.manualOperations}</h1>
        {orgId && hasPermission('accounting.manual_operation.create') && <Link to="/manual-operations/new" className="primary">+ {t.common.create}</Link>}
      </div>

      <div className="inline-form">
        <label>
          {t.common.organization}
          <select value={orgId ?? ''} onChange={(e) => selectOrganization(e.target.value || null)}>
            <option value="" disabled>{t.common.select}</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!orgId ? (
        <p className="panel-note">{t.common.selectOrganization}</p>
      ) : loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="panel-note">No manual operations yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Journal #</th>
              <th>Date</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((op) => (
              <tr key={op.id}>
                <td><Link to={`/manual-operations/${op.id}`}>{op.journalNumber}</Link></td>
                <td>{op.businessDate?.slice(0, 10)}</td>
                <td>{op.description ?? '—'}</td>
                <td><span className={`badge badge-generic-${op.status === 'POSTED' ? 'success' : 'neutral'}`}>{op.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ManualOperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [operation, setOperation] = useState<ManualOperation | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRef[]>([]);
  const [busy, setBusy] = useState(false);

  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: '', side: 'DEBIT', amountBase: '', description: '', dimensions: [] },
    { accountId: '', side: 'CREDIT', amountBase: '', description: '', dimensions: [] },
  ]);

  useEffect(() => {
    if (!orgId) return;
    api.get<Account[]>('/accounting/accounts?includeInactive=false').then((a) => setAccounts(a.filter((x) => x.postingAllowed))).catch(() => {});
    api.get<CurrencyRef[]>('/currencies').then(setCurrencies).catch(() => {});
  }, [orgId]);

  const load = useCallback(async () => {
    if (!orgId || isNew || !id) return;
    try {
      const data = await api.get<ManualOperation>(`/organizations/${orgId}/manual-operations/${id}`);
      setOperation(data);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, id, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  const addLine = () => setLines((ls) => [...ls, { accountId: '', side: 'DEBIT', amountBase: '', description: '', dimensions: [] }]);
  const removeLine = (idx: number) => setLines((ls) => ls.filter((_, i) => i !== idx));
  const updateLine = (idx: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addDimension = (lineIdx: number) => updateLine(lineIdx, { dimensions: [...lines[lineIdx].dimensions, { dimensionCode: DIMENSION_CODES[0], referenceId: '' }] });
  const removeDimension = (lineIdx: number, dimIdx: number) => updateLine(lineIdx, { dimensions: lines[lineIdx].dimensions.filter((_, i) => i !== dimIdx) });
  const updateDimension = (lineIdx: number, dimIdx: number, patch: Partial<DraftDimension>) =>
    updateLine(lineIdx, { dimensions: lines[lineIdx].dimensions.map((d, i) => (i === dimIdx ? { ...d, ...patch } : d)) });

  const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + (Number(l.amountBase) || 0), 0);
  const totalCredit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + (Number(l.amountBase) || 0), 0);
  const balanced = lines.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!balanced) return showError(new Error('Debit and credit totals must match and be greater than zero.'));
    setBusy(true);
    try {
      const created = await api.post<ManualOperation>(`/organizations/${orgId}/manual-operations`, {
        businessDate,
        description: description || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId, side: l.side, amountBase: l.amountBase, description: l.description || undefined,
          dimensions: l.dimensions.length > 0 ? l.dimensions.filter((d) => d.referenceId) : undefined,
        })),
      });
      showSuccess('Saved');
      window.location.href = `/manual-operations/${created.id}`;
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const doPost = async () => {
    if (!orgId || !operation) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/manual-operations/${operation.id}/post`, { expectedVersion: operation.version });
      showSuccess('Posted');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const doUnpost = async () => {
    if (!orgId || !operation) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/manual-operations/${operation.id}/unpost`, { expectedVersion: operation.version });
      showSuccess('Unposted');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const doReverse = async () => {
    if (!orgId || !operation) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/manual-operations/${operation.id}/reverse`, { expectedVersion: operation.version });
      showSuccess('Reversed');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission('accounting.manual_operation.view')) return <p className="panel-note">{t.common.noPermissionView}</p>;
  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;

  if (isNew) {
    return (
      <div>
        <div className="page-header">
          <h1>{t.nav.manualOperations} — {t.common.create}</h1>
          <Link to="/manual-operations">{t.common.back}</Link>
        </div>
        <form onSubmit={create}>
          <div className="inline-form">
            <label>Business date<input type="date" required value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} /></label>
            <label>{t.common.description}<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Side</th>
                <th>Amount</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <Fragment key={idx}>
                  <tr>
                    <td>
                      <select required value={l.accountId} onChange={(e) => updateLine(idx, { accountId: e.target.value })}>
                        <option value="" disabled>{t.common.select}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={l.side} onChange={(e) => updateLine(idx, { side: e.target.value as 'DEBIT' | 'CREDIT' })}>
                        <option value="DEBIT">DEBIT</option>
                        <option value="CREDIT">CREDIT</option>
                      </select>
                    </td>
                    <td>
                      <input type="number" step="any" min="0" required value={l.amountBase} onChange={(e) => updateLine(idx, { amountBase: e.target.value })} />
                    </td>
                    <td>
                      <input value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} />
                    </td>
                    <td>
                      {lines.length > 2 && <button type="button" onClick={() => removeLine(idx)}>Remove</button>}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} style={{ paddingLeft: 24 }}>
                      {l.dimensions.map((d, dimIdx) => (
                        <div className="inline-form" key={dimIdx} style={{ marginBottom: 4 }}>
                          <select value={d.dimensionCode} onChange={(e) => updateDimension(idx, dimIdx, { dimensionCode: e.target.value, referenceId: '' })}>
                            {DIMENSION_CODES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          {d.dimensionCode === 'CURRENCY' ? (
                            <select value={d.referenceId} onChange={(e) => updateDimension(idx, dimIdx, { referenceId: e.target.value })}>
                              <option value="" disabled>{t.common.select}</option>
                              {currencies.map((c) => (
                                <option key={c.id} value={c.id}>{c.code}</option>
                              ))}
                            </select>
                          ) : (
                            <input placeholder="reference id" value={d.referenceId} onChange={(e) => updateDimension(idx, dimIdx, { referenceId: e.target.value })} />
                          )}
                          <button type="button" onClick={() => removeDimension(idx, dimIdx)}>Remove</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => addDimension(idx)}>+ Add dimension</button>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>Totals</th>
                <th className="numeric">D {totalDebit.toFixed(2)} / C {totalCredit.toFixed(2)}</th>
                <th colSpan={2}>{balanced ? '✓ Balanced' : 'Not balanced'}</th>
              </tr>
            </tfoot>
          </table>
          <div className="inline-form">
            <button type="button" onClick={addLine}>+ Add line</button>
            <button type="submit" className="primary" disabled={busy || !balanced}>{busy ? t.common.saving : t.common.save}</button>
          </div>
        </form>
      </div>
    );
  }

  if (!operation) return <p className="panel-note">{t.common.loading}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{operation.journalNumber} <span className={`badge badge-generic-${operation.status === 'POSTED' ? 'success' : 'neutral'}`}>{operation.status}</span></h1>
        <Link to="/manual-operations">{t.common.back}</Link>
      </div>
      <dl className="detail-grid">
        <dt>Business date</dt><dd>{operation.businessDate?.slice(0, 10)}</dd>
        <dt>{t.common.description}</dt><dd>{operation.description ?? '—'}</dd>
      </dl>
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Account</th><th>Side</th><th>Amount</th><th>Description</th></tr>
        </thead>
        <tbody>
          {(operation.lines ?? []).map((l) => (
            <tr key={l.id}>
              <td className="numeric">{l.sequence}</td>
              <td>{accounts.find((a) => a.id === l.accountId)?.code ?? l.accountId.slice(0, 8)} — {accounts.find((a) => a.id === l.accountId)?.name ?? ''}</td>
              <td>{l.side}</td>
              <td className="numeric">{l.amountBase}</td>
              <td>{l.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline-form">
        {operation.status === 'DRAFT' && hasPermission('accounting.manual_operation.post') && (
          <button className="primary" disabled={busy} onClick={doPost}>Post</button>
        )}
        {operation.status === 'POSTED' && hasPermission('accounting.manual_operation.unpost') && (
          <button disabled={busy} onClick={doUnpost}>Unpost</button>
        )}
        {operation.status === 'POSTED' && hasPermission('accounting.journal.reverse') && (
          <button disabled={busy} onClick={doReverse}>Reverse</button>
        )}
      </div>
    </div>
  );
}
