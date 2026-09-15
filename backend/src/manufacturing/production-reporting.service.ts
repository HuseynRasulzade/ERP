import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/** ProductionReportingService — WIP roll-forward (spec section 47) and
 * actual cost breakdown, always derived from `ProductionCostMovement`. */
@Injectable()
export class ProductionReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async wipRollForward(tenantId: string, membershipId: string, organizationId: string, productionOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.productionCostMovement.findMany({ where: { tenantId, productionOrderId, reversed: false }, orderBy: { effectiveDate: 'asc' } });
    const byComponent = new Map<string, { costIn: Decimal; costOut: Decimal }>();
    for (const m of movements) {
      const entry = byComponent.get(m.costComponent) ?? { costIn: new Decimal(0), costOut: new Decimal(0) };
      entry.costIn = entry.costIn.plus(m.costIn.toString());
      entry.costOut = entry.costOut.plus(m.costOut.toString());
      byComponent.set(m.costComponent, entry);
    }
    const breakdown = [...byComponent.entries()].map(([costComponent, v]) => ({ costComponent, costIn: v.costIn.toString(), costOut: v.costOut.toString(), balance: v.costIn.minus(v.costOut).toString() }));
    const totalIn = movements.reduce((s, m) => s.plus(m.costIn.toString()), new Decimal(0));
    const totalOut = movements.reduce((s, m) => s.plus(m.costOut.toString()), new Decimal(0));
    return { breakdown, totalCostsIncurred: totalIn.toString(), totalTransferredOut: totalOut.toString(), closingWip: totalIn.minus(totalOut).toString() };
  }

  async actualCostSummary(tenantId: string, membershipId: string, organizationId: string, productionOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const receipts = await this.prisma.productionOutputReceipt.findMany({ where: { tenantId, organizationId, productionOrderId, postingStatus: 'POSTED' }, include: { output: true } });
    const totalOutputCost = receipts.reduce((s, r) => s.plus(new Decimal(r.provisionalUnitCost?.toString() ?? 0).mul(r.goodQuantity.toString())), new Decimal(0));
    const totalOutputQty = receipts.reduce((s, r) => s.plus(r.goodQuantity.toString()), new Decimal(0));
    return { receiptCount: receipts.length, totalOutputQuantity: totalOutputQty.toString(), totalOutputCost: totalOutputCost.toString(), averageUnitCost: totalOutputQty.gt(0) ? totalOutputCost.dividedBy(totalOutputQty).toString() : '0' };
  }
}
