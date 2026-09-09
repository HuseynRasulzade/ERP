import type { SalesCounterpartyRef, SalesLineDraft, SalesProductRef, SalesUnitRef } from '../../api/types';

/**
 * Phase 4 — shared line editor for sales orders/invoices. A blank price
 * means "resolve from the SALE price list at save time" (backend fills it);
 * an entered price is kept as an explicit override (`priceListId` stays
 * null). Quantity must be > 0, tax rate >= 0 — the backend re-validates.
 */
export function emptyLine(productId = '', unitId = ''): SalesLineDraft {
  return { productId, unitId, quantity: '1', price: '', taxRate: '0', description: '' };
}

export function SalesLinesEditor({
  lines,
  setLines,
  products,
  units,
}: {
  lines: SalesLineDraft[];
  setLines: (lines: SalesLineDraft[]) => void;
  products: SalesProductRef[];
  units: SalesUnitRef[];
}) {
  const patch = (index: number, field: keyof SalesLineDraft, value: string) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));

  return (
    <div>
      {lines.map((line, i) => (
        <div className="inline-form" key={i}>
          <label>
            Product
            <select required value={line.productId} onChange={(e) => patch(i, 'productId', e.target.value)}>
              <option value="" disabled>
                Select…
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <select required value={line.unitId} onChange={(e) => patch(i, 'unitId', e.target.value)}>
              <option value="" disabled>
                Select…
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
            Qty
            <input
              type="number"
              step="any"
              min="0"
              required
              value={line.quantity}
              onChange={(e) => patch(i, 'quantity', e.target.value)}
            />
          </label>
          <label>
            Price (blank = price list)
            <input
              type="number"
              step="any"
              min="0"
              value={line.price}
              onChange={(e) => patch(i, 'price', e.target.value)}
              placeholder="auto"
            />
          </label>
          <label>
            Tax %
            <input
              type="number"
              step="any"
              min="0"
              value={line.taxRate}
              onChange={(e) => patch(i, 'taxRate', e.target.value)}
            />
          </label>
          <label>
            Note
            <input value={line.description} onChange={(e) => patch(i, 'description', e.target.value)} />
          </label>
          <button type="button" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setLines([...lines, emptyLine(lines[0]?.productId ?? '', lines[0]?.unitId ?? '')])
        }
      >
        + Add line
      </button>
    </div>
  );
}

/** Serialize drafts for the backend; blank price/tax/description are omitted. */
export function serializeLines(lines: SalesLineDraft[]) {
  return lines.map((l) => ({
    productId: l.productId,
    unitId: l.unitId,
    quantity: Number(l.quantity),
    ...(l.price.trim() === '' ? {} : { price: Number(l.price) }),
    ...(l.taxRate.trim() === '' ? {} : { taxRate: Number(l.taxRate) }),
    ...(l.description.trim() === '' ? {} : { description: l.description.trim() }),
  }));
}

export function counterpartyName(list: SalesCounterpartyRef[], id: string) {
  return list.find((c) => c.id === id)?.name ?? `${id.slice(0, 8)}…`;
}
