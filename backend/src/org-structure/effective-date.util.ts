/**
 * Shared effective-dated range overlap check (section 29/30), used by both
 * AccountingPolicy and TaxProfile resolution. `validTo: null` means
 * open-ended (still in effect).
 */
export function rangesOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo ?? new Date('9999-12-31');
  const bEnd = bTo ?? new Date('9999-12-31');
  return aFrom <= bEnd && bFrom <= aEnd;
}
