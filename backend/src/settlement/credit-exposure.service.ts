import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

export type OverdueCreditPolicy = 'NONE' | 'WARNING' | 'BLOCK' | 'APPROVAL_REQUIRED';

/**
 * CustomerCreditExposureService (spec sections 75-77) — the stable
 * interface Sales Pre-Order/Execution (Phases 6-7) can call before
 * confirming a new order. Not wired into those modules in this build
 * (spec section 172's own boundary: "onların istifadə edəcəyi stable
 * interfaces və events yarat" — building the interface is this phase's
 * job; consuming it from Phase 6/7 is a follow-up).
 */
@Injectable()
export class CreditExposureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** Open Receivables + open Sales Orders (optional) — Phase 6 order
   * exposure is not summed here (no dependency on sales-preorder from
   * this module), only the receivable half spec section 76 marks
   * mandatory. */
  async getCurrentExposure(tenantId: string, membershipId: string, organizationId: string, customerId: string): Promise<string> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const [receivables, advances] = await Promise.all([
      this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId: customerId, itemType: 'RECEIVABLE', status: { notIn: ['SETTLED', 'CANCELLED', 'WRITTEN_OFF'] } } }),
      this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId: customerId, itemType: 'CUSTOMER_ADVANCE', status: { notIn: ['CANCELLED'] } } }),
    ]);
    const receivableTotal = receivables.reduce((s, r) => s.plus(r.remainingAmount.toString()), new Decimal(0));
    const advanceTotal = advances.reduce((s, r) => s.plus(r.remainingAmount.toString()), new Decimal(0)).abs();
    return receivableTotal.minus(advanceTotal).toFixed(2);
  }

  async getAvailableCredit(tenantId: string, membershipId: string, organizationId: string, customerId: string): Promise<string | null> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const customer = await this.prisma.counterparty.findFirst({ where: { id: customerId, tenantId, organizationId } });
    if (!customer) throw new NotFoundAppError('Counterparty', customerId);
    if (customer.creditLimit == null) return null;
    const exposure = new Decimal(await this.getCurrentExposure(tenantId, membershipId, organizationId, customerId));
    return new Decimal(customer.creditLimit.toString()).minus(exposure).toFixed(2);
  }

  async validateOrderCredit(tenantId: string, membershipId: string, organizationId: string, customerId: string, newOrderAmount: Decimal.Value): Promise<{ allowed: boolean; policy: OverdueCreditPolicy; availableCredit: string | null; hasOverdue: boolean }> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const available = await this.getAvailableCredit(tenantId, membershipId, organizationId, customerId);
    const overdueItems = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId: customerId, itemType: 'RECEIVABLE', dueDate: { lt: new Date() }, status: { notIn: ['SETTLED', 'CANCELLED', 'DISPUTED', 'ON_HOLD'] } } });
    const hasOverdue = overdueItems.some((i) => new Decimal(i.remainingAmount.toString()).abs().gt(0.005));
    const policy: OverdueCreditPolicy = hasOverdue ? 'BLOCK' : 'NONE';
    const withinLimit = available === null || new Decimal(available).gte(newOrderAmount);
    return { allowed: withinLimit && policy !== 'BLOCK', policy, availableCredit: available, hasOverdue };
  }
}
