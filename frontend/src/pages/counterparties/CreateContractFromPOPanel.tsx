import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { BizDoc, CounterpartyContract } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

/** Bespoke "Create Contract" panel injected on a Purchase Order's detail
 * page (via `renderExtras`, mirroring HoldsPanel). Only meaningful once the
 * order is confirmed (posted) — spec section 11. Lets the user pick which
 * lines to carry over and how much of each; the server is the final judge
 * of remaining quantity (see CounterpartyContractService.remainingForPurchaseOrderLine)
 * so an over-allocation attempt here still surfaces as a clear error toast. */
export function CreateContractFromPOPanel({ orgId, doc }: { orgId: string; doc: BizDoc }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  if (!hasPermission('contract.create') || doc.postingStatus !== 'POSTED') return null;

  const lines = doc.lines ?? [];

  const openPanel = () => {
    const nextSelected: Record<string, boolean> = {};
    const nextQty: Record<string, string> = {};
    for (const line of lines) {
      const remaining = Number(line.quantity ?? 0) - Number((line as { cancelledQuantity?: string }).cancelledQuantity ?? 0);
      if (line.id && remaining > 0) {
        nextSelected[line.id] = true;
        nextQty[line.id] = String(remaining);
      }
    }
    setSelected(nextSelected);
    setQuantities(nextQty);
    setNumber('');
    setSubject('');
    setOpen(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const chosenLines = lines
        .filter((l) => l.id && selected[l.id])
        .map((l) => ({ purchaseOrderLineId: l.id as string, quantity: quantities[l.id as string] ? Number(quantities[l.id as string]) : undefined }));
      const created = await api.post<CounterpartyContract>(`/organizations/${orgId}/contracts/from-purchase-order`, {
        purchaseOrderId: doc.id,
        number,
        subject: subject || undefined,
        lines: chosenLines.length > 0 ? chosenLines : undefined,
      });
      showSuccess(t.contract.contractCreated);
      setOpen(false);
      navigate(`/counterparties/${created.counterpartyId}/contracts/${created.id}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>{t.contract.createFromPO}</h2>
        {!open && <button className="primary" onClick={openPanel}>{t.contract.createFromPO}</button>}
      </div>
      {open ? (
        <form onSubmit={create}>
          <p className="panel-note">{t.contract.createFromPOHint}</p>
          <div className="inline-form">
            <label>{t.counterparty.contractNumber}<input required value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <label>{t.counterparty.subject}<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          </div>
          {lines.length === 0 ? (
            <p className="panel-note">{t.contract.noLinesYet}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{t.contract.product}</th>
                  <th>{t.contract.quantity}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  if (!line.id) return null;
                  return (
                    <tr key={line.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selected[line.id]}
                          onChange={(e) => setSelected({ ...selected, [line.id as string]: e.target.checked })}
                        />
                      </td>
                      <td>{line.productId}</td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          disabled={!selected[line.id]}
                          value={quantities[line.id] ?? ''}
                          onChange={(e) => setQuantities({ ...quantities, [line.id as string]: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="inline-form">
            <button type="submit" className="primary" disabled={busy}>{busy ? t.common.saving : t.common.create}</button>
            <button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
