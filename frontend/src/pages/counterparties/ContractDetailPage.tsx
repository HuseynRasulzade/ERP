import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, CounterpartyContract, CounterpartyContractAmendment, CounterpartyContractLine, Product } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import { CP_STATUS_CLASS } from './CounterpartyListPage';
import { DocumentManager } from './DocumentManager';

export function ContractDetailPage() {
  const { id: counterpartyId, contractId } = useParams<{ id: string; contractId: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const orgId = currentOrganizationId;

  const [contract, setContract] = useState<CounterpartyContract | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    subject: '', contractType: '', signedDate: '', startDate: '', endDate: '',
    amount: '', currencyId: '', paymentTerms: '', responsiblePersonId: '',
    hasAdvance: false, advancePercent: '', remainingPaymentDueDays: '',
    deliveryDate: '', deliveryTermDays: '', deliveryAddress: '', deliveryTerms: '',
    warrantyPeriod: '', penaltyTerms: '', otherTerms: '', priceIncludesTax: false,
  });

  const load = useCallback(async () => {
    if (!orgId || !contractId) return;
    try {
      const data = await api.get<CounterpartyContract>(`/organizations/${orgId}/contracts/${contractId}`);
      setContract(data);
      setForm({
        subject: data.subject, contractType: data.contractType ?? '',
        signedDate: data.signedDate?.slice(0, 10) ?? '', startDate: data.startDate?.slice(0, 10) ?? '', endDate: data.endDate?.slice(0, 10) ?? '',
        amount: data.amount ?? '', currencyId: data.currencyId ?? '', paymentTerms: data.paymentTerms ?? '', responsiblePersonId: data.responsiblePersonId ?? '',
        hasAdvance: data.hasAdvance, advancePercent: data.advancePercent ?? '', remainingPaymentDueDays: data.remainingPaymentDueDays != null ? String(data.remainingPaymentDueDays) : '',
        deliveryDate: data.deliveryDate?.slice(0, 10) ?? '', deliveryTermDays: data.deliveryTermDays != null ? String(data.deliveryTermDays) : '',
        deliveryAddress: data.deliveryAddress ?? '', deliveryTerms: data.deliveryTerms ?? '',
        warrantyPeriod: data.warrantyPeriod ?? '', penaltyTerms: data.penaltyTerms ?? '', otherTerms: data.otherTerms ?? '', priceIncludesTax: data.priceIncludesTax,
      });
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!contract || !orgId) return;
    setBusy(true);
    try {
      await api.patch(`/organizations/${orgId}/contracts/${contract.id}`, {
        expectedVersion: contract.version,
        subject: form.subject, contractType: form.contractType || undefined,
        signedDate: form.signedDate || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined,
        amount: form.amount ? Number(form.amount) : undefined, currencyId: form.currencyId || undefined,
        paymentTerms: form.paymentTerms || undefined, responsiblePersonId: form.responsiblePersonId || undefined,
        hasAdvance: form.hasAdvance, remainingPaymentDueDays: form.remainingPaymentDueDays ? Number(form.remainingPaymentDueDays) : undefined,
        deliveryDate: form.deliveryDate || undefined, deliveryTermDays: form.deliveryTermDays ? Number(form.deliveryTermDays) : undefined,
        deliveryAddress: form.deliveryAddress || undefined, deliveryTerms: form.deliveryTerms || undefined,
        warrantyPeriod: form.warrantyPeriod || undefined, penaltyTerms: form.penaltyTerms || undefined,
        otherTerms: form.otherTerms || undefined, priceIncludesTax: form.priceIncludesTax,
      });
      showSuccess(t.toast.updatedItem(contract.number));
      setEditing(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!contract || !orgId) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contract.id}/approve`, { expectedVersion: contract.version });
      showSuccess(t.contract.approved);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!contract) return <p className="panel-note">{t.common.loading}</p>;

  return (
    <div className="document-detail">
      <div className="page-header">
        <div>
          <h1>{contract.number} — {contract.subject}</h1>
          <div className="badge-row">
            <span className={`badge badge-generic-${CP_STATUS_CLASS[contract.status] ?? 'neutral'}`}>{contract.status}</span>
          </div>
        </div>
        <div className="actions">
          <Link to={`/counterparties/${counterpartyId}`} className="link-muted">{t.contract.backToCounterparty}</Link>
          {hasPermission('contract.edit') && !editing && <button onClick={() => setEditing(true)}>{t.counterparty.edit}</button>}
          {hasPermission('contract.approve') && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && (
            <button className="primary" disabled={busy} onClick={approve}>{t.contract.approve}</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="card">
          <div className="inline-form">
            <label>{t.counterparty.subject}<input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label>{t.counterparty.contractType}<input value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })} placeholder="e.g. SUPPLY, SERVICE, LEASE" /></label>
            <label>{t.counterparty.responsiblePerson}<input value={form.responsiblePersonId} onChange={(e) => setForm({ ...form, responsiblePersonId: e.target.value })} placeholder="responsible person id" /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.signedDate}<input type="date" value={form.signedDate} onChange={(e) => setForm({ ...form, signedDate: e.target.value })} /></label>
            <label>{t.counterparty.startDate}<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
            <label>{t.counterparty.endDate}<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.counterparty.amount}<input type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} disabled={(contract.lines?.length ?? 0) > 0} /></label>
            <label>{t.counterparty.currency}<input value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })} placeholder="currency id" /></label>
            <label>{t.counterparty.paymentTerms}<input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. NET 30" /></label>
          </div>
          <h3>{t.contract.terms}</h3>
          <div className="inline-form">
            <label className="checkbox-label"><input type="checkbox" checked={form.hasAdvance} onChange={(e) => setForm({ ...form, hasAdvance: e.target.checked })} /> {t.contract.hasAdvance}</label>
            <label>{t.contract.remainingPaymentDueDays}<input type="number" value={form.remainingPaymentDueDays} onChange={(e) => setForm({ ...form, remainingPaymentDueDays: e.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={form.priceIncludesTax} onChange={(e) => setForm({ ...form, priceIncludesTax: e.target.checked })} /> {t.contract.priceIncludesTax}</label>
          </div>
          <div className="inline-form">
            <label>{t.contract.deliveryDate}<input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} /></label>
            <label>{t.contract.deliveryTermDays}<input type="number" value={form.deliveryTermDays} onChange={(e) => setForm({ ...form, deliveryTermDays: e.target.value })} /></label>
            <label>{t.contract.warrantyPeriod}<input value={form.warrantyPeriod} onChange={(e) => setForm({ ...form, warrantyPeriod: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.deliveryAddress}<input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.deliveryTerms}<input value={form.deliveryTerms} onChange={(e) => setForm({ ...form, deliveryTerms: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.penaltyTerms}<input value={form.penaltyTerms} onChange={(e) => setForm({ ...form, penaltyTerms: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.otherTerms}<input value={form.otherTerms} onChange={(e) => setForm({ ...form, otherTerms: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{t.common.cancel}</button>
          </div>
        </form>
      ) : (
        <section className="card">
          <dl className="kv-grid">
            <dt>{t.counterparty.contractType}</dt><dd>{contract.contractType ?? '—'}</dd>
            <dt>{t.counterparty.signedDate}</dt><dd>{contract.signedDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.startDate}</dt><dd>{contract.startDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.endDate}</dt><dd>{contract.endDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.counterparty.amount}</dt><dd className="numeric">{contract.amount ?? '—'}</dd>
            <dt>{t.counterparty.paymentTerms}</dt><dd>{contract.paymentTerms ?? '—'}</dd>
            <dt>{t.counterparty.responsiblePerson}</dt><dd>{contract.responsiblePersonId ?? '—'}</dd>
            <dt>{t.contract.deliveryDate}</dt><dd>{contract.deliveryDate?.slice(0, 10) ?? '—'}</dd>
            <dt>{t.contract.deliveryTermDays}</dt><dd>{contract.deliveryTermDays ?? '—'}</dd>
            <dt>{t.contract.deliveryAddress}</dt><dd>{contract.deliveryAddress ?? '—'}</dd>
            <dt>{t.contract.deliveryTerms}</dt><dd>{contract.deliveryTerms ?? '—'}</dd>
            <dt>{t.contract.warrantyPeriod}</dt><dd>{contract.warrantyPeriod ?? '—'}</dd>
            <dt>{t.contract.penaltyTerms}</dt><dd>{contract.penaltyTerms ?? '—'}</dd>
            <dt>{t.contract.otherTerms}</dt><dd>{contract.otherTerms ?? '—'}</dd>
            <dt>{t.contract.priceIncludesTax}</dt><dd>{contract.priceIncludesTax ? t.common.yes : t.common.no}</dd>
            <dt>{t.common.version}</dt><dd>{contract.version}</dd>
          </dl>
        </section>
      )}

      <section className="card">
        <SourcePurchaseOrderSection orgId={orgId} counterpartyId={counterpartyId!} contract={contract} onChanged={load} />
      </section>

      <section className="card">
        <AdvanceSection orgId={orgId} contract={contract} onChanged={load} />
      </section>

      <section className="card">
        <TotalsSection contract={contract} />
      </section>

      <section className="card">
        <LinesSection orgId={orgId} contract={contract} onChanged={load} />
      </section>

      <section className="card">
        <DocumentManager orgId={orgId} ownerType="CONTRACT" ownerId={contract.id} />
      </section>

      <section className="card">
        <AmendmentsSection orgId={orgId} contractId={contract.id} onChanged={load} />
      </section>
    </div>
  );
}

/** The contract form's mandatory "Alış sifarişini seç" field — lists only
 * POSTED purchase orders for this counterparty with remaining quantity
 * and no blank-price line (spec section 11). Also doubles as the
 * "change source PO" action on an existing DRAFT contract: switching
 * discards and replaces every line, so the user is warned first when the
 * contract's lines were hand-edited since the last pull (`linesDirty`). */
function SourcePurchaseOrderSection({ orgId, counterpartyId, contract, onChanged }: { orgId: string; counterpartyId: string; contract: CounterpartyContract; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [eligible, setEligible] = useState<BizDoc[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL';

  useEffect(() => {
    if (!editable || !hasPermission('contract.edit')) return;
    api.get<BizDoc[]>(`/organizations/${orgId}/counterparties/${counterpartyId}/contracts/eligible-purchase-orders`)
      .then(setEligible)
      .catch((err) => showError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, counterpartyId, editable]);

  const currentPO = eligible.find((o) => o.id === contract.sourcePurchaseOrderId);

  const change = async () => {
    if (!selected) return;
    if (contract.linesDirty && !window.confirm(t.contract.changeSourcePOConfirm)) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contract.id}/source-purchase-order`, { purchaseOrderId: selected, expectedVersion: contract.version });
      showSuccess(t.toast.updatedItem(contract.number));
      setSelected('');
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>{t.contract.selectPurchaseOrder}</h2>
      <dl className="kv-grid">
        <dt>{t.contract.sourcePO}</dt>
        <dd>{contract.sourcePurchaseOrderId ? (currentPO?.number ?? contract.sourcePurchaseOrderId) : '—'}</dd>
      </dl>
      {editable && hasPermission('contract.edit') && (
        eligible.length === 0 ? (
          <p className="panel-note">{t.contract.noEligiblePurchaseOrders}</p>
        ) : (
          <div className="inline-form">
            <label>{t.contract.changeSourcePO}
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">{t.common.select}</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>{o.number} — {o.grandTotal ?? ''}</option>
                ))}
              </select>
            </label>
            <button disabled={!selected || busy} onClick={change}>{busy ? t.common.saving : t.contract.changeSourcePO}</button>
          </div>
        )
      )}
    </div>
  );
}

function AdvanceSection({ orgId, contract, onChanged }: { orgId: string; contract: CounterpartyContract; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(contract.advancePercent ?? '');
  const [amount, setAmount] = useState(contract.advanceAmount ?? '');

  useEffect(() => {
    setPercent(contract.advancePercent ?? '');
    setAmount(contract.advanceAmount ?? '');
  }, [contract.advancePercent, contract.advanceAmount]);

  const save = async (overrideAmount: boolean) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contract.id}/advance`, {
        expectedVersion: contract.version,
        advancePercent: percent !== '' ? Number(percent) : null,
        advanceAmount: overrideAmount && amount !== '' ? Number(amount) : undefined,
      });
      showSuccess(t.toast.updatedItem(contract.number));
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>{t.contract.hasAdvance}</h2>
      <dl className="kv-grid">
        <dt>{t.contract.advancePercent}</dt>
        <dd>
          {hasPermission('contract.edit') ? (
            <input type="number" step="any" style={{ width: '6rem' }} value={percent} onChange={(e) => setPercent(e.target.value)} />
          ) : (percent || '—')}
        </dd>
        <dt>{t.contract.advanceAmount}</dt>
        <dd>
          {hasPermission('contract.edit') ? (
            <input type="number" step="any" style={{ width: '8rem' }} value={amount} onChange={(e) => setAmount(e.target.value)} />
          ) : (contract.advanceAmount ?? '—')}
          {' '}
          <span className="panel-note">{contract.advanceAmountManual ? t.contract.advanceManual : t.contract.advanceAuto}</span>
        </dd>
      </dl>
      {hasPermission('contract.edit') && (
        <div className="inline-form">
          <button disabled={busy} onClick={() => save(false)}>{t.contract.saveAdvance} ({t.contract.advanceAuto})</button>
          <button disabled={busy} onClick={() => save(true)}>{t.contract.saveAdvance} ({t.contract.advanceManual})</button>
        </div>
      )}
      <dl className="kv-grid">
        <dt>{t.contract.remainingPayable}</dt><dd className="numeric">{contract.remainingPayableAmount ?? '—'}</dd>
      </dl>
    </div>
  );
}

function TotalsSection({ contract }: { contract: CounterpartyContract }) {
  const { t } = useLocale();
  return (
    <div>
      <h2>{t.contract.totals}</h2>
      <dl className="kv-grid">
        <dt>{t.contract.subtotal}</dt><dd className="numeric">{contract.subtotal ?? '—'}</dd>
        <dt>{t.contract.totalDiscount}</dt><dd className="numeric">{contract.totalDiscount ?? '—'}</dd>
        <dt>{t.contract.totalTax}</dt><dd className="numeric">{contract.totalTax ?? '—'}</dd>
        <dt>{t.contract.grandTotal}</dt><dd className="numeric">{contract.amount ?? '—'} {contract.currencyId ?? ''}</dd>
      </dl>
    </div>
  );
}

/** Nomenclature lines are always PO-derived — no manual "any product"
 * entry (spec section 11). Adding a line means picking one of the source
 * PO's own lines that isn't fully on the contract yet (`availablePOLines`,
 * fetched from the PO itself) and optionally a reduced quantity. */
function LinesSection({ orgId, contract, onChanged }: { orgId: string; contract: CounterpartyContract; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [poLines, setPoLines] = useState<NonNullable<BizDoc['lines']>>([]);
  const [selectedPoLineId, setSelectedPoLineId] = useState('');
  const [quantity, setQuantity] = useState('');

  const lines = contract.lines ?? [];
  const productName = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    return p ? `${p.code} — ${p.name}` : pid.slice(0, 8);
  };

  useEffect(() => {
    api.get<Product[]>(`/organizations/${orgId}/products`).then(setProducts).catch(() => {});
  }, [orgId]);

  useEffect(() => {
    if (!contract.sourcePurchaseOrderId) { setPoLines([]); return; }
    api.get<BizDoc>(`/organizations/${orgId}/purchase-orders/${contract.sourcePurchaseOrderId}`)
      .then((po) => setPoLines(po.lines ?? []))
      .catch(() => setPoLines([]));
  }, [orgId, contract.sourcePurchaseOrderId, lines.length]);

  const usedPoLineIds = new Set(lines.map((l) => l.sourceOrderLineId).filter(Boolean));
  const availablePoLines = poLines.filter((l) => l.id && !usedPoLineIds.has(l.id));

  const addLine = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contract.id}/lines`, {
        sourceOrderLineId: selectedPoLineId,
        quantity: quantity ? Number(quantity) : undefined,
      });
      showSuccess(t.toast.createdItem(productName((poLines.find((l) => l.id === selectedPoLineId)?.productId as string) ?? '')));
      setSelectedPoLineId(''); setQuantity('');
      setShowForm(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const removeLine = async (line: CounterpartyContractLine) => {
    setBusy(true);
    try {
      await api.delete(`/organizations/${orgId}/contracts/${contract.id}/lines/${line.id}`);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t.contract.lines}</h2>
        {hasPermission('contract.edit') && contract.sourcePurchaseOrderId && availablePoLines.length > 0 && (
          <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.contract.addLineFromPO}</button>
        )}
      </div>
      {!contract.sourcePurchaseOrderId && <p className="panel-note">{t.contract.manualLineBlockedHint}</p>}
      {showForm && (
        <form onSubmit={addLine} className="inline-form">
          <label>{t.contract.product}
            <select required value={selectedPoLineId} onChange={(e) => setSelectedPoLineId(e.target.value)}>
              <option value="">{t.common.select}</option>
              {availablePoLines.map((l) => (
                <option key={l.id} value={l.id}>{productName(l.productId as string)} ({l.quantity})</option>
              ))}
            </select>
          </label>
          <label>{t.contract.quantity}<input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={t.contract.quantity} /></label>
          <button type="submit" className="primary" disabled={busy || !selectedPoLineId}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {lines.length === 0 ? (
        <p className="panel-note">{t.contract.noLinesYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.contract.product}</th>
              <th>{t.contract.quantity}</th>
              <th>{t.contract.unitPrice}</th>
              <th>{t.contract.discountAmount}</th>
              <th>{t.contract.taxBase}</th>
              <th>{t.contract.taxRate}</th>
              <th>{t.contract.taxAmount}</th>
              <th>{t.contract.lineTotal}</th>
              <th>{t.contract.sourcePO}</th>
              <th>{t.contract.sourceRequirement}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className={line.taxCalculationError ? 'row-missing-price' : undefined}>
                <td>{productName(line.productId)}{line.description ? <div className="panel-note">{line.description}</div> : null}</td>
                <td className="numeric">{line.quantity} {line.unitId}</td>
                <td className="numeric">{line.unitPrice}</td>
                <td className="numeric">{line.discountAmount}</td>
                <td className="numeric">{line.taxBase}</td>
                <td className="numeric">{line.taxRatePercent ?? '—'}</td>
                <td className="numeric">
                  {line.taxAmount ?? '—'}
                  {line.taxMismatch && <span className="badge badge-generic-warn" title={t.contract.taxMismatchWarning}> ⚠</span>}
                </td>
                <td className="numeric">{line.lineTotal ?? '—'}</td>
                <td>{line.sourceChain?.purchaseOrderNumber ?? (line.sourceOrderLineId ? '✓' : '—')}</td>
                <td>{line.sourceChain?.purchaseRequirementNumber ?? '—'}</td>
                <td>
                  {hasPermission('contract.edit') && <button className="small" disabled={busy} onClick={() => removeLine(line)}>{t.contract.removeLine}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lines.some((l) => l.taxCalculationError) && (
        <p className="panel-note" style={{ color: 'var(--color-danger, #c0392b)' }}>
          {t.contract.taxError}: {lines.filter((l) => l.taxCalculationError).map((l) => l.taxCalculationError).join('; ')}
        </p>
      )}
      {lines.some((l) => l.taxMismatch) && (
        <p className="panel-note" style={{ color: 'var(--color-warning, #b98900)' }}>{t.contract.taxMismatchWarning}</p>
      )}
    </div>
  );
}

function AmendmentsSection({ orgId, contractId, onChanged }: { orgId: string; contractId: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [amendments, setAmendments] = useState<CounterpartyContractAmendment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const [subject, setSubject] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.get<CounterpartyContractAmendment[]>(`/organizations/${orgId}/contracts/${contractId}/amendments`);
      setAmendments(list);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contracts/${contractId}/amendments`, { number, subject });
      showSuccess(t.toast.createdItem(number));
      setNumber(''); setSubject('');
      setShowForm(false);
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
        <h2>{t.contract.amendments}</h2>
        {hasPermission('contract.amendment.create') && <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? t.common.cancel : t.contract.addAmendment}</button>}
      </div>
      {showForm && (
        <form onSubmit={create} className="inline-form">
          <label>{t.contract.amendmentNumber}<input required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
          <label>{t.counterparty.subject}<input required value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
        </form>
      )}
      {amendments.length === 0 ? (
        <p className="panel-note">{t.contract.noAmendmentsYet}</p>
      ) : (
        amendments.map((a) => <AmendmentCard key={a.id} orgId={orgId} amendment={a} onChanged={() => { load(); onChanged(); }} />)
      )}
    </div>
  );
}

function AmendmentCard({ orgId, amendment, onChanged }: { orgId: string; amendment: CounterpartyContractAmendment; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    subject: amendment.subject, amendmentDate: amendment.amendmentDate?.slice(0, 10) ?? '',
    effectiveDate: amendment.effectiveDate?.slice(0, 10) ?? '', endDate: amendment.endDate?.slice(0, 10) ?? '',
    newAmount: amendment.newAmount ?? '', currencyId: amendment.currencyId ?? '', changeDescription: amendment.changeDescription ?? '',
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/organizations/${orgId}/contract-amendments/${amendment.id}`, {
        expectedVersion: amendment.version,
        subject: form.subject, amendmentDate: form.amendmentDate || undefined, effectiveDate: form.effectiveDate || undefined,
        endDate: form.endDate || undefined, newAmount: form.newAmount ? Number(form.newAmount) : undefined,
        currencyId: form.currencyId || undefined, changeDescription: form.changeDescription || undefined,
      });
      showSuccess(t.toast.updatedItem(amendment.number));
      setEditing(false);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contract-amendments/${amendment.id}/approve`, { expectedVersion: amendment.version });
      showSuccess(t.contract.approved);
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: '0.75rem' }}>
      <div className="page-header">
        <h3>{amendment.number} — {amendment.subject}</h3>
        <div className="actions">
          <span className={`badge badge-generic-${CP_STATUS_CLASS[amendment.status] ?? 'neutral'}`}>{amendment.status}</span>
          {hasPermission('contract.amendment.edit') && !editing && <button className="small" onClick={() => setEditing(true)}>{t.counterparty.edit}</button>}
          {hasPermission('contract.amendment.approve') && (amendment.status === 'DRAFT' || amendment.status === 'PENDING_APPROVAL') && (
            <button className="small primary" disabled={busy} onClick={approve}>{t.contract.approve}</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save}>
          <div className="inline-form">
            <label>{t.counterparty.subject}<input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label>{t.contract.amendmentDate}<input type="date" value={form.amendmentDate} onChange={(e) => setForm({ ...form, amendmentDate: e.target.value })} /></label>
            <label>{t.contract.effectiveDate}<input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></label>
            <label>{t.contract.endDate}<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <label>{t.contract.newAmount}<input type="number" step="any" value={form.newAmount} onChange={(e) => setForm({ ...form, newAmount: e.target.value })} /></label>
            <label>{t.counterparty.currency}<input value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })} placeholder="currency id" /></label>
          </div>
          <div className="inline-form">
            <label style={{ flex: 1 }}>{t.contract.changeDescription}<input value={form.changeDescription} onChange={(e) => setForm({ ...form, changeDescription: e.target.value })} /></label>
          </div>
          <div className="inline-form">
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{t.common.cancel}</button>
          </div>
        </form>
      ) : (
        <dl className="kv-grid">
          <dt>{t.contract.amendmentDate}</dt><dd>{amendment.amendmentDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.effectiveDate}</dt><dd>{amendment.effectiveDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.endDate}</dt><dd>{amendment.endDate?.slice(0, 10) ?? '—'}</dd>
          <dt>{t.contract.newAmount}</dt><dd className="numeric">{amendment.newAmount ?? '—'}</dd>
          <dt>{t.contract.changeDescription}</dt><dd>{amendment.changeDescription ?? '—'}</dd>
        </dl>
      )}

      <DocumentManager orgId={orgId} ownerType="CONTRACT_AMENDMENT" ownerId={amendment.id} />
    </div>
  );
}
