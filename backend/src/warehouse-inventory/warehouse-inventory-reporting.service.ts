import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { StockAvailabilityService } from './stock-availability.service';
import { PHYSICAL_STOCK_STATUSES } from './inventory-movement.service';

/**
 * Read-only reporting surface for the Stock Truth Engine (spec sections
 * 58-63, 86). Every figure is computed live from `InventoryMovement`
 * (via StockAvailabilityService, or a direct groupBy for the multi-row
 * reports below) — never a cached snapshot.
 */
@Injectable()
export class WarehouseInventoryReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly availability: StockAvailabilityService,
  ) {}

  /** Stock Balance report (section 58) — physical/available/reserved per
   * warehouse+product that has ever had a movement. */
  async stockBalance(tenantId: string, membershipId: string, organizationId: string, opts: { warehouseId?: string; productId?: string } = {}) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const grouped = await this.prisma.inventoryMovement.groupBy({
      by: ['warehouseId', 'productId'],
      where: {
        tenantId,
        organizationId,
        stockStatus: { in: PHYSICAL_STOCK_STATUSES },
        ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
        ...(opts.productId ? { productId: opts.productId } : {}),
      },
      _sum: { quantity: true },
    });

    const rows = [];
    for (const g of grouped) {
      const physical = new Decimal((g._sum.quantity ?? 0).toString());
      if (physical.isZero()) continue;
      const [available, reserved] = await Promise.all([
        this.availability.getAvailableStock(tenantId, g.warehouseId, g.productId),
        this.availability.getReservedStock(tenantId, g.warehouseId, g.productId),
      ]);
      rows.push({ warehouseId: g.warehouseId, productId: g.productId, physical: physical.toString(), available: available.toString(), reserved: reserved.toString() });
    }
    return rows;
  }

  /** Stock Card (section 59) — full ordered movement history / drill-down
   * for one warehouse+product (optionally one batch). */
  async stockCard(tenantId: string, membershipId: string, organizationId: string, warehouseId: string, productId: string, batchId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryMovement.findMany({
      where: { tenantId, organizationId, warehouseId, productId, ...(batchId ? { batchId } : {}) },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Batch report (section 60-ish) — every batch with its current
   * physical quantity and expiry. */
  async batchReport(tenantId: string, membershipId: string, organizationId: string, productId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const batches = await this.prisma.batch.findMany({ where: { tenantId, organizationId, ...(productId ? { productId } : {}) }, orderBy: { createdAt: 'desc' } });
    const rows = [];
    for (const batch of batches) {
      const quantity = await this.availability.getStockByBatch(tenantId, batch.id);
      if (quantity.isZero()) continue;
      rows.push({ ...batch, currentQuantity: quantity.toString() });
    }
    return rows;
  }

  /** Serial report (spec section 23) — every serial with its current
   * status/location and, on request, its full movement history. */
  async serialReport(tenantId: string, membershipId: string, organizationId: string, productId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.serialNumber.findMany({ where: { tenantId, organizationId, ...(productId ? { productId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async serialHistory(tenantId: string, membershipId: string, organizationId: string, serialId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const serial = await this.prisma.serialNumber.findFirst({ where: { id: serialId, tenantId, organizationId } });
    if (!serial) throw new NotFoundAppError('SerialNumber', serialId);
    return this.prisma.inventoryMovement.findMany({ where: { tenantId, serialId }, orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] });
  }

  /** Negative Stock report (section 63) — every warehouse/product whose
   * live AVAILABLE balance has gone negative (only reachable when that
   * warehouse permits it). */
  async negativeStockReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const grouped = await this.prisma.inventoryMovement.groupBy({
      by: ['warehouseId', 'productId'],
      where: { tenantId, organizationId, stockStatus: 'AVAILABLE' },
      _sum: { quantity: true },
    });
    const rows = [];
    for (const g of grouped) {
      const available = await this.availability.getAvailableStock(tenantId, g.warehouseId, g.productId);
      if (available.lt(0)) rows.push({ warehouseId: g.warehouseId, productId: g.productId, available: available.toString() });
    }
    return rows;
  }

  /** Min/Max report (section 63) — products whose current available
   * stock has fallen at/below `product.reorderPoint`/`minimumStock`. */
  async minMaxReport(tenantId: string, membershipId: string, organizationId: string, warehouseId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const products = await this.prisma.product.findMany({
      where: { tenantId, organizationId, OR: [{ minimumStock: { not: null } }, { reorderPoint: { not: null } }] },
    });
    const warehouses = warehouseId
      ? [await this.prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId, organizationId } })].filter((w): w is NonNullable<typeof w> => !!w)
      : await this.prisma.warehouse.findMany({ where: { tenantId, organizationId, active: true } });

    const rows = [];
    for (const product of products) {
      for (const warehouse of warehouses) {
        const available = await this.availability.getAvailableStock(tenantId, warehouse.id, product.id);
        const threshold = product.reorderPoint ?? product.minimumStock;
        if (threshold != null && available.lte(new Decimal(threshold.toString()))) {
          rows.push({
            warehouseId: warehouse.id,
            productId: product.id,
            available: available.toString(),
            minimumStock: product.minimumStock?.toString() ?? null,
            reorderPoint: product.reorderPoint?.toString() ?? null,
            maximumStock: product.maximumStock?.toString() ?? null,
          });
        }
      }
    }
    return rows;
  }
}
