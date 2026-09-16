import type { LineDraft, SalesProductRef, SalesUnitRef, Warehouse } from '../../api/types';
import { useLocale } from '../../i18n/LocaleContext';

export function emptyDocLine(productId = '', unitId = '', warehouseId = ''): LineDraft {
  return { productId, unitId, quantity: '1', price: '', taxRate: '', warehouseId, description: '', lineType: 'INVENTORY' };
}

export interface DocLinesEditorProps {
  lines: LineDraft[];
  setLines: (lines: LineDraft[]) => void;
  products: SalesProductRef[];
  units: SalesUnitRef[];
  warehouses?: Warehouse[];
  showPrice?: boolean;
  showTax?: boolean;
  showWarehouse?: boolean;
  priceHint?: string;
  /** Goods Receipt only: shows an "over-receipt reason" input, required by
   * the backend whenever a PO-linked line's quantity exceeds what remains
   * on the order — advisory client-side, the server is authoritative. */
  showOverReceiptReason?: boolean;
}

/** Generic editable line grid shared by every "priced document" kind
 * (Sales/Purchase Order, Sales/Purchase Invoice, Goods Receipt) — columns
 * toggle on/off per kind via props rather than duplicating this grid per
 * document type. A blank price/tax means "let the backend resolve it". */
export function DocLinesEditor({ lines, setLines, products, units, warehouses, showPrice = true, showTax = true, showWarehouse = false, priceHint, showOverReceiptReason = false }: DocLinesEditorProps) {
  const { t } = useLocale();
  const patch = (index: number, field: keyof LineDraft, value: string) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));

  return (
    <div>
      {lines.map((line, i) => (
        <div className="inline-form" key={i}>
          <label>
            {t.common.product}
            <select required value={line.productId} onChange={(e) => patch(i, 'productId', e.target.value)}>
              <option value="" disabled>
                {t.common.select}
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.common.unit}
            <select required value={line.unitId} onChange={(e) => patch(i, 'unitId', e.target.value)}>
              <option value="" disabled>
                {t.common.select}
              </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                  {u.symbol ? ` (${u.symbol})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.common.quantity}
            <input type="number" step="any" min="0" required value={line.quantity} onChange={(e) => patch(i, 'quantity', e.target.value)} />
          </label>
          {showPrice && (
            <label>
              {t.common.price} {priceHint ? `(${priceHint})` : ''}
              <input type="number" step="any" min="0" value={line.price} onChange={(e) => patch(i, 'price', e.target.value)} placeholder="auto" />
            </label>
          )}
          {showTax && (
            <label>
              {t.common.taxRate}
              <input type="number" step="any" min="0" value={line.taxRate} onChange={(e) => patch(i, 'taxRate', e.target.value)} placeholder="auto" />
            </label>
          )}
          {showWarehouse && warehouses && (
            <label>
              {t.common.warehouse}
              <select value={line.warehouseId} onChange={(e) => patch(i, 'warehouseId', e.target.value)}>
                <option value="">{t.common.select}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t.common.description}
            <input value={line.description} onChange={(e) => patch(i, 'description', e.target.value)} />
          </label>
          {showOverReceiptReason && line.supplierOrderLineId && (
            <label>
              {t.common.overReceiptReason}
              <input value={line.overReceiptReason ?? ''} onChange={(e) => patch(i, 'overReceiptReason', e.target.value)} placeholder={t.common.overReceiptReasonHint} />
            </label>
          )}
          <button type="button" className="small" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            {t.common.remove}
          </button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => setLines([...lines, emptyDocLine(lines[0]?.productId ?? '', lines[0]?.unitId ?? '', lines[0]?.warehouseId ?? '')])}>
        {t.common.addLine}
      </button>
    </div>
  );
}

export function serializeDocLines(lines: LineDraft[], opts: { showPrice?: boolean; showTax?: boolean; showWarehouse?: boolean } = {}) {
  return lines.map((l) => ({
    productId: l.productId,
    unitId: l.unitId,
    quantity: Number(l.quantity),
    ...(opts.showPrice !== false && l.price.trim() !== '' ? { price: Number(l.price) } : {}),
    ...(opts.showTax !== false && l.taxRate.trim() !== '' ? { taxRate: Number(l.taxRate) } : {}),
    ...(opts.showWarehouse && l.warehouseId ? { warehouseId: l.warehouseId } : {}),
    ...(l.description.trim() === '' ? {} : { description: l.description.trim() }),
    // Never edited through this grid — carried through so a line re-saved
    // after a manual price/tax fix keeps its Purchase Requirement link.
    ...(l.requirementLineId ? { requirementLineId: l.requirementLineId } : {}),
    ...(l.supplierOrderLineId ? { supplierOrderLineId: l.supplierOrderLineId } : {}),
    ...(l.overReceiptReason?.trim() ? { overReceiptReason: l.overReceiptReason.trim() } : {}),
  }));
}
