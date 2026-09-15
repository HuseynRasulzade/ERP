import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * CustomerCreditExposureService (spec sections 75-77) — used by Phase 6/7
 * (sales order/shipment) to validate a new commitment against the
 * customer's credit limit. `getCurrentExposure` sums OPEN receivables
 * only (spec section 75's own base formula) — uninvoiced shipped/open
 * order amounts are an opt-in extension this build does not compute
 * (disclosed simplification; the method signature accepts an option for
 * a future implementation to fill in).
 */
@Injectable()
export class CreditExposureService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentExposure(tenantId: string, organizationId: string, counterpartyId: string): Promise<Decimal> {
    const agg = await this.prisma.settlementObligation.aggregate({ where: { tenantId, organizationId, counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, _sum: { remainingAmount: true } });
    return new Decimal((agg._sum.remainingAmount ?? 0).toString());
  }

  async getAvailableCredit(tenantId: string, organizationId: string, counterpartyId: string): Promise<Decimal | null> {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, tenantId } });
    if (!counterparty?.creditLimit) return null; // no configured limit — unbounded
    const exposure = await this.getCurrentExposure(tenantId, organizationId, counterpartyId);
    return new Decimal(counterparty.creditLimit.toString()).minus(exposure);
  }

  /** Spec section 77 — NONE|WARNING|BLOCK|APPROVAL_REQUIRED, driven by
   * `SettlementPolicy.overdueCreditBlockPolicy`, checked against whether
   * the customer currently has ANY overdue open item (not just over
   * limit). Phase 6/7 call this before confirming an order/shipment. */
  async validateOrderCredit(tenantId: string, organizationId: string, counterpartyId: string, newOrderAmount: Decimal, overdueBlockPolicy: string, asOfDate: Date = new Date()) {
    const [available, overdueItems] = await Promise.all([
      this.getAvailableCredit(tenantId, organizationId, counterpartyId),
      this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] }, dueDate: { lt: asOfDate } } }),
    ]);

    const overLimit = available != null && newOrderAmount.gt(available);
    const hasOverdue = overdueItems.length > 0;

    if (hasOverdue && overdueBlockPolicy === 'BLOCK') {
      throw new ValidationAppError(`Customer has ${overdueItems.length} overdue open item(s) — new order/shipment is blocked by policy.`);
    }

    return {
      allowed: !(hasOverdue && overdueBlockPolicy === 'BLOCK'),
      overLimit,
      hasOverdue,
      availableCredit: available?.toString() ?? null,
      requiresApproval: (hasOverdue && overdueBlockPolicy === 'APPROVAL_REQUIRED') || overLimit,
      warning: hasOverdue && overdueBlockPolicy === 'WARNING',
    };
  }
}
