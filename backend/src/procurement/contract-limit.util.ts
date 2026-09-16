import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';

export interface ContractLimitCheck {
  limitAmount: Decimal | null;
  policy: 'WARN' | 'BLOCK' | 'APPROVAL';
  currentTotal: Decimal; // sum of every OTHER non-cancelled PO's grandTotal against this contract
  projectedTotal: Decimal; // currentTotal + this order's own grandTotal
  exceeds: boolean;
}

/** Sums every other non-cancelled PurchaseOrder referencing `contractId`
 * (excluding `excludePurchaseOrderId`, so re-checking an existing order
 * on edit doesn't double-count itself) and compares against the
 * contract's own limitAmount. Returns null if the contract has no limit
 * set at all. */
export async function checkContractLimit(
  prisma: PrismaTransactionClient,
  tenantId: string,
  contractId: string,
  excludePurchaseOrderId: string | undefined,
  thisOrderGrandTotal: Decimal,
): Promise<ContractLimitCheck | null> {
  const contract = await prisma.counterpartyContract.findFirst({ where: { id: contractId, tenantId } });
  if (!contract || contract.limitAmount == null) return null;

  const others = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      contractId,
      status: { not: 'CANCELLED' },
      ...(excludePurchaseOrderId ? { id: { not: excludePurchaseOrderId } } : {}),
    },
    select: { grandTotal: true },
  });
  const currentTotal = others.reduce((sum, o) => sum.plus(o.grandTotal.toString()), new Decimal(0));
  const limitAmount = new Decimal(contract.limitAmount.toString());
  const projectedTotal = currentTotal.plus(thisOrderGrandTotal);

  return {
    limitAmount,
    policy: (contract.limitPolicy as 'WARN' | 'BLOCK' | 'APPROVAL') ?? 'WARN',
    currentTotal,
    projectedTotal,
    exceeds: projectedTotal.gt(limitAmount),
  };
}
