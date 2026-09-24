import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * InventoryValuationService — current-state valuation query (spec section
 * 76). Reads whichever projection the active costing method maintains:
 * InventoryCostBalance for WEIGHTED_AVERAGE, or an aggregate over open
 * InventoryCostLayer rows for FIFO — never a mutable field on Product.
 */
@Injectable()
export class InventoryValuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async valuation(tenantId: string, membershipId: string, organizationId: string, filters: { productId?: string; warehouseId?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const balances = await this.prisma.inventoryCostBalance.findMany({
      where: { tenantId, organizationId },
    });
    const layerGroups = await this.prisma.inventoryCostLayer.groupBy({
      by: ['costingKey'],
      where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } },
      _sum: { remainingQuantity: true, currentRemainingValue: true },
    });

    const rows = [
      ...balances.map((b) => ({
        costingKey: b.costingKey,
        method: 'WEIGHTED_AVERAGE',
        quantity: b.quantity.toString(),
        value: b.totalValue.toString(),
        unitCost: b.averageUnitCost.toString(),
      })),
      ...layerGroups.map((g) => ({
        costingKey: g.costingKey,
        method: 'FIFO',
        quantity: (g._sum.remainingQuantity ?? 0).toString(),
        value: (g._sum.currentRemainingValue ?? 0).toString(),
        unitCost: g._sum.remainingQuantity && Number(g._sum.remainingQuantity) !== 0
          ? (Number(g._sum.currentRemainingValue ?? 0) / Number(g._sum.remainingQuantity)).toFixed(6)
          : '0',
      })),
    ];

    return rows.filter((r) => {
      if (filters.productId && !r.costingKey.includes(filters.productId)) return false;
      if (filters.warehouseId && !r.costingKey.includes(filters.warehouseId)) return false;
      return true;
    });
  }

  async cogs(tenantId: string, membershipId: string, organizationId: string, filters: { fromDate?: Date; toDate?: Date }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCostMovement.findMany({
      where: {
        tenantId,
        organizationId,
        movementType: 'ISSUE',
        ...(filters.fromDate || filters.toDate
          ? { effectiveDate: { ...(filters.fromDate ? { gte: filters.fromDate } : {}), ...(filters.toDate ? { lte: filters.toDate } : {}) } }
          : {}),
      },
      orderBy: { effectiveDate: 'desc' },
      take: 500,
    });
  }

  async layers(tenantId: string, membershipId: string, organizationId: string, filters: { productId?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCostLayer.findMany({
      where: { tenantId, organizationId, ...(filters.productId ? { productId: filters.productId } : {}) },
      orderBy: [{ receiptDate: 'desc' }, { postingSequence: 'desc' }],
      take: 500,
    });
  }
}
