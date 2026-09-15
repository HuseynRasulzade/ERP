import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface ProductionHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  productionOrderId?: string;
  message: string;
}

/** ProductionHealthService — computed live, same convention as every
 * other health service in this codebase. */
@Injectable()
export class ProductionHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<ProductionHealthIssue[]> {
    const issues: ProductionHealthIssue[] = [];

    const staleOrders = await this.prisma.productionOrder.findMany({ where: { tenantId, organizationId, status: 'ACTIVE', closeStatus: 'OPEN', createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
    for (const o of staleOrders) issues.push({ code: 'STALE_OPEN_PRODUCTION_ORDER', severity: 'WARNING', productionOrderId: o.id, message: `Production order ${o.number ?? o.id} has been open for over 90 days.` });

    const openOrders = await this.prisma.productionOrder.findMany({ where: { tenantId, organizationId, closeStatus: 'OPEN' } });
    for (const o of openOrders) {
      const wipAgg = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId: o.id, reversed: false }, _sum: { costIn: true, costOut: true } });
      const wip = new Decimal((wipAgg._sum.costIn ?? 0).toString()).minus((wipAgg._sum.costOut ?? 0).toString());
      if (wip.lt(-0.05)) issues.push({ code: 'NEGATIVE_WIP_BALANCE', severity: 'BLOCKING', productionOrderId: o.id, message: `Production order ${o.number ?? o.id} has a negative WIP balance of ${wip.toString()}.` });
    }

    const shortages = await this.prisma.productionMaterialRequirement.findMany({ where: { tenantId, reservationStatus: { in: ['NONE', 'PARTIAL'] }, order: { organizationId, status: { in: ['ACTIVE'] }, closeStatus: 'OPEN' } } });
    if (shortages.length > 0) issues.push({ code: 'MATERIAL_SHORTAGE', severity: 'WARNING', message: `${shortages.length} material requirement(s) are not fully reserved.` });

    const unallocatedPools = await this.prisma.productionOverheadPool.count({ where: { tenantId, organizationId, status: 'OPEN', period: { lt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1) } } });
    if (unallocatedPools > 0) issues.push({ code: 'OVERHEAD_POOL_NOT_ALLOCATED', severity: 'WARNING', message: `${unallocatedPools} overhead pool(s) from a prior period have not been allocated.` });

    return issues;
  }
}
