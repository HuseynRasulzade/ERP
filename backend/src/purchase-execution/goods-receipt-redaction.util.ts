/** Strips price/lineTotal from a GoodsReceipt's lines when the caller
 * lacks PURCHASE_PRICE_VIEW — a warehouse user sees quantity, product,
 * unit, warehouse, but never the purchase price or its line total. */
export function redactGoodsReceiptPrices<T extends Record<string, any> | null | undefined>(receipt: T, canViewPrice: boolean): T {
  if (canViewPrice || !receipt) return receipt;
  const lines = (receipt as any).lines;
  return {
    ...receipt,
    ...(lines
      ? {
          lines: lines.map((line: any) => {
            const { price, lineTotal, ...rest } = line;
            return rest;
          }),
        }
      : {}),
  } as T;
}
