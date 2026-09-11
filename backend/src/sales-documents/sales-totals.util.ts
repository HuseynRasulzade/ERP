import { Decimal } from '@prisma/client/runtime/library';

export interface ComputedLine {
  quantity: Decimal;
  // Nullable only so a PurchaseOrder line with no resolvable price (see
  // PurchaseOrderService.resolveLines) can still flow through
  // sumDocumentTotals, which never reads price itself.
  price: Decimal | null;
  taxRate: Decimal;
  lineTotal: Decimal;
  taxAmount: Decimal;
  lineTotalWithTax: Decimal;
}

function round2(value: Decimal): Decimal {
  return new Decimal(value.toFixed(2));
}

/**
 * Single line math. `priceIncludesTax=false` (default): price is net, tax is
 * added on top. `true`: price is gross, net is derived by dividing out tax.
 * Line totals are rounded to 2 decimals (currency precision); quantity/price
 * keep 6-decimal precision from the DTO.
 */
export function computeLineTotals(
  quantity: Decimal,
  price: Decimal,
  taxRate: Decimal,
  priceIncludesTax: boolean,
): ComputedLine {
  if (priceIncludesTax) {
    const gross = round2(quantity.mul(price));
    const divisor = new Decimal(1).add(taxRate.div(100));
    const net = round2(gross.div(divisor));
    return {
      quantity,
      price,
      taxRate,
      lineTotal: net,
      taxAmount: round2(gross.sub(net)),
      lineTotalWithTax: gross,
    };
  }
  const net = round2(quantity.mul(price));
  const tax = round2(net.mul(taxRate).div(100));
  return {
    quantity,
    price,
    taxRate,
    lineTotal: net,
    taxAmount: tax,
    lineTotalWithTax: round2(net.add(tax)),
  };
}

export function sumDocumentTotals(lines: ComputedLine[]): {
  subtotal: Decimal;
  taxTotal: Decimal;
  grandTotal: Decimal;
} {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let grandTotal = new Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(line.lineTotal);
    taxTotal = taxTotal.add(line.taxAmount);
    grandTotal = grandTotal.add(line.lineTotalWithTax);
  }
  return { subtotal, taxTotal, grandTotal };
}
