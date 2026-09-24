import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { SalesOrder, Warehouse } from '../../api/types';

interface CreditCheckResult {
  status: string;
  creditLimit: string | null;
  currentExposure: string | null;
  newOrderExposure: string;
  projectedExposure: string;
  availableLimit: string | null;
  actionPolicy: string;
  explanation: string;
}

/** Phase 6 (spec sections 54-58) credit check — a read-only, on-demand
 * check against the counterparty's configured credit limit. Not run
 * automatically; the user requests it explicitly, mirroring how 1C's
 * "Check credit" action works (not a silent background gate here). */
export function CreditCheckPanel({ orgId, doc }: { orgId: string; doc: SalesOrder }) {
  const { hasPermission } = useAuth();
  const { showError } = useToast();
  const [result, setResult] = useState<CreditCheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasPermission('sales_order.view')) return null;

  const check = async () => {
    setBusy(true);
    try {
      setResult(await api.get<CreditCheckResult>(`/organizations/${orgId}/sales-orders/${doc.id}/check-credit`));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>Credit check</h2>
        <button className="small" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check credit'}</button>
      </div>
      {result && (
        <dl className="kv-grid">
          <dt>Status</dt><dd>{result.status}</dd>
          <dt>Credit limit</dt><dd className="numeric">{result.creditLimit ?? '—'}</dd>
          <dt>This order's amount</dt><dd className="numeric">{result.newOrderExposure}</dd>
          <dt>Available limit after this order</dt><dd className="numeric">{result.availableLimit ?? '—'}</dd>
          <dt>Action policy</dt><dd>{result.actionPolicy}</dd>
          <dt>Explanation</dt><dd>{result.explanation}</dd>
        </dl>
      )}
    </section>
  );
}

interface LineFulfillment {
  lineId: string;
  productId: string;
  ordered: string;
  cancelled: string;
  fulfilled: string;
  reserved: string;
  planned: string;
  remaining: string;
}

/** Phase 6 (spec sections 27-28, 83-84) fulfillment summary — live-computed
 * per-line ordered/fulfilled/reserved/planned/remaining quantities. */
export function FulfillmentPanel({ orgId, doc, productName }: { orgId: string; doc: SalesOrder; productName: (id: string) => string }) {
  const { hasPermission } = useAuth();
  const { showError } = useToast();
  const [lines, setLines] = useState<LineFulfillment[] | null>(null);

  const load = useCallback(async () => {
    try {
      setLines(await api.get<LineFulfillment[]>(`/organizations/${orgId}/sales-orders/${doc.id}/fulfillment`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, doc.id]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('sales.fulfillment.view')) return null;

  return (
    <section className="card">
      <h2>Fulfillment</h2>
      {!lines || lines.length === 0 ? (
        <p className="panel-note">No lines.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th><th>Ordered</th><th>Cancelled</th><th>Fulfilled</th><th>Reserved</th><th>Planned</th><th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineId}>
                <td>{productName(l.productId)}</td>
                <td className="numeric">{l.ordered}</td>
                <td className="numeric">{l.cancelled}</td>
                <td className="numeric">{l.fulfilled}</td>
                <td className="numeric">{l.reserved}</td>
                <td className="numeric">{l.planned}</td>
                <td className="numeric">{l.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface StockReservation {
  id: string;
  sourceLineId: string;
  productId: string;
  warehouseId: string | null;
  quantity: string;
  status: string;
  validUntil: string | null;
  version: number;
}

/** Phase 6 (spec sections 37-42) stock reservations — a planning/
 * commitment object against the order's own remaining quantity (no real
 * warehouse-stock check here; see ReservationService's docstring). */
export function ReservationsPanel({ orgId, doc, warehouses, productName }: { orgId: string; doc: SalesOrder; warehouses: Warehouse[]; productName: (id: string) => string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [reservations, setReservations] = useState<StockReservation[]>([]);
  const [lineId, setLineId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReservations(await api.get<StockReservation[]>(`/organizations/${orgId}/sales-orders/${doc.id}/reservations`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, doc.id]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('sales.reservation.view')) return null;

  const lines = doc.lines ?? [];

  const reserve = async () => {
    if (!lineId || !warehouseId || !quantity) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/sales-orders/${doc.id}/reservations`, {
        lines: [{ salesOrderLineId: lineId, warehouseId, quantity }],
      });
      showSuccess('Reserved');
      setQuantity('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const release = async (r: StockReservation) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/stock-reservations/${r.id}/release`, { expectedVersion: r.version });
      showSuccess('Released');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Reservations</h2>
      {reservations.length === 0 ? (
        <p className="panel-note">No reservations.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Product</th><th>Warehouse</th><th>Quantity</th><th>Status</th><th>Valid until</th><th></th></tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id}>
                <td>{productName(r.productId)}</td>
                <td>{warehouses.find((w) => w.id === r.warehouseId)?.name ?? '—'}</td>
                <td className="numeric">{r.quantity}</td>
                <td>{r.status}</td>
                <td>{r.validUntil?.slice(0, 10) ?? '—'}</td>
                <td>
                  {(r.status === 'ACTIVE' || r.status === 'PARTIALLY_RELEASED') && hasPermission('sales.reservation.manage') && (
                    <button className="small" disabled={busy} onClick={() => release(r)}>Release</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasPermission('sales.reservation.manage') && (
        <div className="inline-form" style={{ marginTop: 14 }}>
          <label>
            Line
            <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">Select…</option>
              {lines.map((l) => l.id && <option key={l.id} value={l.id}>{productName(l.productId)} (qty {l.quantity})</option>)}
            </select>
          </label>
          <label>
            Warehouse
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </label>
          <label>
            Quantity
            <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <button className="small" disabled={busy || !lineId || !warehouseId || !quantity} onClick={reserve}>Reserve</button>
        </div>
      )}
    </section>
  );
}

interface ShipmentPlanLine {
  id: string;
  salesOrderLineId: string;
  plannedQuantity: string;
  warehouseId: string | null;
  plannedDate: string;
}
interface ShipmentPlanRow {
  id: string;
  plannedDate: string;
  warehouseId: string | null;
  deliveryAddress: string | null;
  carrier: string | null;
  status: string;
  lines: ShipmentPlanLine[];
}

/** Phase 6 (spec sections 45-48) shipment plans — a planning object;
 * creating one does not itself fulfill the order (only an actual
 * Shipment execution does). */
export function ShipmentPlansPanel({ orgId, doc, warehouses, productName }: { orgId: string; doc: SalesOrder; warehouses: Warehouse[]; productName: (id: string) => string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [plans, setPlans] = useState<ShipmentPlanRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [carrier, setCarrier] = useState('');
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await api.get<ShipmentPlanRow[]>(`/organizations/${orgId}/sales-orders/${doc.id}/shipment-plans`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, doc.id]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('sales.shipment_plan.view')) return null;

  const orderLines = doc.lines ?? [];

  const create = async () => {
    const lines = orderLines
      .filter((l) => l.id && lineQty[l.id])
      .map((l) => ({ salesOrderLineId: l.id as string, plannedQuantity: lineQty[l.id as string] }));
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/sales-orders/${doc.id}/shipment-plans`, {
        plannedDate,
        warehouseId: warehouseId || undefined,
        deliveryAddress: deliveryAddress || undefined,
        carrier: carrier || undefined,
        lines,
      });
      showSuccess('Shipment plan created');
      setLineQty({});
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>Shipment plans</h2>
        {hasPermission('sales.shipment_plan.manage') && (
          <button className="small" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New plan'}</button>
        )}
      </div>
      {plans.length === 0 ? (
        <p className="panel-note">No shipment plans.</p>
      ) : (
        plans.map((p) => (
          <table key={p.id} className="data-table" style={{ marginBottom: 10 }}>
            <thead>
              <tr><th colSpan={4}>{p.plannedDate.slice(0, 10)} — {p.status} — {p.carrier ?? 'no carrier'}</th></tr>
              <tr><th>Product</th><th>Planned qty</th><th>Warehouse</th><th>Date</th></tr>
            </thead>
            <tbody>
              {p.lines.map((l) => {
                const orderLine = orderLines.find((ol) => ol.id === l.salesOrderLineId);
                return (
                  <tr key={l.id}>
                    <td>{orderLine ? productName(orderLine.productId) : l.salesOrderLineId.slice(0, 8)}</td>
                    <td className="numeric">{l.plannedQuantity}</td>
                    <td>{warehouses.find((w) => w.id === l.warehouseId)?.name ?? '—'}</td>
                    <td>{l.plannedDate.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))
      )}
      {showForm && (
        <div className="card">
          <div className="inline-form">
            <label>Planned date<input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></label>
            <label>
              Warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </label>
            <label>Delivery address<input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} /></label>
            <label>Carrier<input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></label>
          </div>
          <table className="data-table">
            <thead><tr><th>Product</th><th>Ordered</th><th>Planned qty</th></tr></thead>
            <tbody>
              {orderLines.map((l) => l.id && (
                <tr key={l.id}>
                  <td>{productName(l.productId)}</td>
                  <td className="numeric">{l.quantity}</td>
                  <td><input type="number" step="any" value={lineQty[l.id] ?? ''} onChange={(e) => setLineQty({ ...lineQty, [l.id as string]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="small primary" disabled={busy} onClick={create}>{busy ? 'Saving…' : 'Create plan'}</button>
        </div>
      )}
    </section>
  );
}

interface PaymentScheduleRow {
  id: string;
  sequence: number;
  dueDate: string;
  percentage: string | null;
  amount: string;
  status: string;
}

/** Phase 6 (spec sections 49-53) order payment schedule — installments
 * supplied directly (due date + percentage or fixed amount); the last
 * installment always absorbs rounding so the schedule sums exactly to
 * the order's grand total. */
export function PaymentSchedulePanel({ orgId, doc }: { orgId: string; doc: SalesOrder }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [schedule, setSchedule] = useState<PaymentScheduleRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [installments, setInstallments] = useState<{ dueDate: string; percentage: string }[]>([
    { dueDate: new Date().toISOString().slice(0, 10), percentage: '50' },
    { dueDate: new Date().toISOString().slice(0, 10), percentage: '50' },
  ]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSchedule(await api.get<PaymentScheduleRow[]>(`/organizations/${orgId}/sales-orders/${doc.id}/payment-schedule`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, doc.id]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('sales.payment_schedule.view')) return null;

  const generate = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/sales-orders/${doc.id}/payment-schedule`, {
        installments: installments.map((i) => ({ dueDate: i.dueDate, percentage: i.percentage })),
      });
      showSuccess('Payment schedule generated');
      setShowForm(false);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-header">
        <h2>Payment schedule</h2>
        <button className="small" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : schedule.length > 0 ? 'Regenerate' : '+ Generate'}</button>
      </div>
      {schedule.length === 0 ? (
        <p className="panel-note">No payment schedule.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>#</th><th>Due date</th><th>%</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {schedule.map((s) => (
              <tr key={s.id}>
                <td>{s.sequence + 1}</td>
                <td>{s.dueDate.slice(0, 10)}</td>
                <td className="numeric">{s.percentage ?? '—'}</td>
                <td className="numeric">{s.amount}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showForm && (
        <div className="card">
          <p className="panel-note">Percentages must sum to 100%. Order total: {doc.grandTotal}.</p>
          {installments.map((inst, idx) => (
            <div className="inline-form" key={idx}>
              <label>Due date<input type="date" value={inst.dueDate} onChange={(e) => setInstallments(installments.map((x, i) => (i === idx ? { ...x, dueDate: e.target.value } : x)))} /></label>
              <label>Percentage<input type="number" step="any" value={inst.percentage} onChange={(e) => setInstallments(installments.map((x, i) => (i === idx ? { ...x, percentage: e.target.value } : x)))} /></label>
              <button className="small" type="button" onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}>Remove</button>
            </div>
          ))}
          <div className="inline-form">
            <button className="small" type="button" onClick={() => setInstallments([...installments, { dueDate: new Date().toISOString().slice(0, 10), percentage: '' }])}>+ Add installment</button>
            <button className="small primary" disabled={busy} onClick={generate}>{busy ? 'Saving…' : 'Generate'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

interface SupplyPeg {
  id: string;
  demandLineId: string;
  supplyId: string;
  supplyLineId: string;
  quantity: string;
  status: string;
}

interface OpenPurchaseOrderLine {
  id: string;
  productId: string;
  quantity: string;
  cancelledQuantity: string;
}

interface OpenPurchaseOrder {
  id: string;
  number: string;
  counterpartyId: string;
  lines: OpenPurchaseOrderLine[];
}

/** Phase 8 (spec sections 88-91) supply pegging — links a specific sales
 * order demand line to a specific open purchase order line, distinct from
 * Phase 6's StockReservation (which reserves against the order's own
 * remaining quantity, not a named incoming PO). Demand-side only; the
 * backend has no route to list pegs from the supply (PO) side. */
export function SupplyPegPanel({ orgId, doc, productName }: { orgId: string; doc: SalesOrder; productName: (id: string) => string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [lineId, setLineId] = useState('');
  const [pegs, setPegs] = useState<SupplyPeg[]>([]);
  const [openPOs, setOpenPOs] = useState<OpenPurchaseOrder[]>([]);
  const [supplyLineId, setSupplyLineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = doc.lines ?? [];

  useEffect(() => {
    api.get<OpenPurchaseOrder[]>(`/organizations/${orgId}/procurement/open-purchase-orders`).then(setOpenPOs).catch(() => {});
  }, [orgId]);

  const load = useCallback(async () => {
    if (!lineId) {
      setPegs([]);
      return;
    }
    try {
      setPegs(await api.get<SupplyPeg[]>(`/organizations/${orgId}/supply-pegs?demandType=SALES_ORDER&demandId=${doc.id}&demandLineId=${lineId}`));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, doc.id, lineId]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission('purchase.supply_planning.view')) return null;

  const selectedLine = lines.find((l) => l.id === lineId);
  const supplyLineOptions = openPOs.flatMap((po) =>
    po.lines
      .filter((pl) => !selectedLine || pl.productId === selectedLine.productId)
      .map((pl) => ({ po, line: pl })),
  );

  const peg = async () => {
    if (!lineId || !supplyLineId || !quantity) return;
    const match = supplyLineOptions.find((o) => o.line.id === supplyLineId);
    if (!match) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/supply-pegs`, {
        demandType: 'SALES_ORDER', demandId: doc.id, demandLineId: lineId,
        supplyType: 'PURCHASE_ORDER', supplyId: match.po.id, supplyLineId,
        quantity: Number(quantity),
      });
      showSuccess('Pegged');
      setQuantity('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: SupplyPeg) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/supply-pegs/${p.id}/remove`, {});
      showSuccess('Peg removed');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Supply pegging</h2>
      <div className="inline-form">
        <label>
          Line
          <select value={lineId} onChange={(e) => { setLineId(e.target.value); setSupplyLineId(''); }}>
            <option value="">Select…</option>
            {lines.map((l) => l.id && <option key={l.id} value={l.id}>{productName(l.productId)} (qty {l.quantity})</option>)}
          </select>
        </label>
      </div>

      {lineId && (
        <>
          {pegs.length === 0 ? (
            <p className="panel-note">No pegs for this line.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Purchase order</th><th>Quantity</th><th>Status</th><th /></tr></thead>
              <tbody>
                {pegs.map((p) => (
                  <tr key={p.id}>
                    <td>{openPOs.find((po) => po.id === p.supplyId)?.number ?? p.supplyId.slice(0, 8)}</td>
                    <td className="numeric">{p.quantity}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.status === 'ACTIVE' && hasPermission('purchase.supply_pegging.manage') && (
                        <button className="small" disabled={busy} onClick={() => remove(p)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {hasPermission('purchase.supply_pegging.manage') && (
            <div className="inline-form" style={{ marginTop: 14 }}>
              <label>
                Purchase order line
                <select value={supplyLineId} onChange={(e) => setSupplyLineId(e.target.value)}>
                  <option value="">Select…</option>
                  {supplyLineOptions.map((o) => (
                    <option key={o.line.id} value={o.line.id}>
                      {o.po.number} — {productName(o.line.productId)} (remaining {(Number(o.line.quantity) - Number(o.line.cancelledQuantity)).toString()})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </label>
              <button className="small" disabled={busy || !supplyLineId || !quantity} onClick={peg}>Peg</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
