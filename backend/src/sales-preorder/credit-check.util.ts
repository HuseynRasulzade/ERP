import Decimal from 'decimal.js';

export interface CreditCheckCalc {
  status: 'NOT_CHECKED' | 'WITHIN_LIMIT' | 'APPROVAL_REQUIRED' | 'BLOCKED';
  actionPolicy: 'NONE' | 'REQUIRE_APPROVAL' | 'BLOCK';
  explanation: string;
}

const WARNING_GRACE_PERCENT = 10;

/**
 * Pure credit-limit calculation, shared by `CreditCheckService.check`
 * (posting-time, reads the counterparty via `this.prisma`) and
 * `SalesOrderApprovalPlanProvider.planSteps` (create-time, reads the
 * counterparty inside the creation transaction) — extracted so both run
 * the identical threshold logic without one calling through the other's
 * transaction boundary.
 *
 * An order within the grace band above the limit used to be a no-op
 * WARNING (recorded, never blocking). It now requires SALES_MANAGER
 * approval before the order can be posted — the pre-existing but
 * previously unused `APPROVAL_REQUIRED`/`REQUIRE_APPROVAL` values this
 * codebase already defined. An order beyond the grace band is still a
 * hard BLOCK that no approval can override.
 */
export function calculateCreditCheck(creditLimit: Decimal | null, orderAmount: Decimal): CreditCheckCalc {
  if (!creditLimit) {
    return { status: 'NOT_CHECKED', actionPolicy: 'NONE', explanation: 'No credit limit configured for this counterparty — nothing to check against.' };
  }

  const warningThreshold = creditLimit.mul(1 + WARNING_GRACE_PERCENT / 100);
  if (orderAmount.lte(creditLimit)) {
    return {
      status: 'WITHIN_LIMIT',
      actionPolicy: 'NONE',
      explanation: `Order amount ${orderAmount.toFixed(2)} is within the configured credit limit ${creditLimit.toFixed(2)}.`,
    };
  }
  if (orderAmount.lte(warningThreshold)) {
    return {
      status: 'APPROVAL_REQUIRED',
      actionPolicy: 'REQUIRE_APPROVAL',
      explanation: `Order amount ${orderAmount.toFixed(2)} exceeds the credit limit ${creditLimit.toFixed(2)} but is within the ${WARNING_GRACE_PERCENT}% grace band — requires sales manager approval.`,
    };
  }
  return {
    status: 'BLOCKED',
    actionPolicy: 'BLOCK',
    explanation: `Order amount ${orderAmount.toFixed(2)} exceeds the credit limit ${creditLimit.toFixed(2)} beyond the ${WARNING_GRACE_PERCENT}% grace band.`,
  };
}
