import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface ExpectedSupplyRow {
  purchaseOrderLineId: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string | null;
  productId: string;
  warehouseId: string | null;
  expectedDate: string;
  quantity: string;
  counterpartyId: string;
}

/**
 * ExpectedStockService (spec sections 44, 61, 88-90, 112-113, 132).
 * Deliberately NOT a persisted "ExpectedReceipt" table — Expected Supply
 * is computed live from CONFIRMED (postingStatus=POSTED, not cancelled)
 * PurchaseOrderLines, reading `PurchaseDeliveryScheduleLine` when a line
 * has one instead of representing the whole line quantity at one
 * arbitrary date (spec section 61). This mirrors the codebase's existing
 * pattern of computing planning quantities live rather than caching them
 * (see OrderFulfillmentService) and keeps Phase 9's Goods Receipt from
 * having two competing sources of "what's expected" to reconcile.
 *
 * Every quantity here is EXPECTED, never physical stock (spec sections
 * 95, 103, 132) — Goods Receipt (Phase 9) is the only thing that changes
 * real inventory.
 */
@Injectable()
export class ExpectedStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async forProduct(tenantId: string, membershipId: string, organizationId: string, productId: string, warehouseId?: string): Promise<ExpectedSupplyRow[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        tenantId,
        productId,
        isService: false,
        purchaseOrder: { organizationId, postingStatus: 'POSTED', status: { not: 'CANCELLED' } },
      },
      include: { purchaseOrder: true, deliverySchedule: true },
    });

    const rows: ExpectedSupplyRow[] = [];
    for (const line of lines) {
      const lineWarehouseId = line.warehouseId ?? line.purchaseOrder.warehouseId;
      if (warehouseId && lineWarehouseId !== warehouseId) continue;

      const remaining = new Decimal(line.quantity.toString()).minus(line.cancelledQuantity.toString());
      if (remaining.lte(0)) continue;

      if (line.deliverySchedule.length > 0) {
        for (const d of line.deliverySchedule) {
          rows.push({
            purchaseOrderLineId: line.id,
            purchaseOrderId: line.purchaseOrderId,
            purchaseOrderNumber: line.purchaseOrder.number,
            productId: line.productId,
            warehouseId: d.warehouseId ?? lineWarehouseId ?? null,
            expectedDate: d.plannedDate.toISOString().slice(0, 10),
            quantity: d.quantity.toString(),
            counterpartyId: line.purchaseOrder.counterpartyId,
          });
        }
      } else {
        const expectedDate = line.expectedDeliveryDate ?? line.purchaseOrder.expectedDeliveryDate ?? line.purchaseOrder.documentDate;
        rows.push({
          purchaseOrderLineId: line.id,
          purchaseOrderId: line.purchaseOrderId,
          purchaseOrderNumber: line.purchaseOrder.number,
          productId: line.productId,
          warehouseId: lineWarehouseId ?? null,
          expectedDate: expectedDate.toISOString().slice(0, 10),
          quantity: remaining.toString(),
          counterpartyId: line.purchaseOrder.counterpartyId,
        });
      }
    }
    return rows;
  }

  /** Open Purchase Orders (spec section 88): confirmed, not cancelled,
   * remaining receivable quantity > 0. This build has no Goods Receipt
   * yet (Phase 9), so "received" is always 0 and remaining receivable is
   * simply ordered minus cancelled on at least one line. */
  async openPurchaseOrders(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { organizationId, postingStatus: 'POSTED', status: { not: 'CANCELLED' } },
      include: { lines: true },
    });
    return orders.filter((o) => o.lines.some((l) => new Decimal(l.quantity.toString()).minus(l.cancelledQuantity.toString()).gt(0)));
  }

  /** Late Purchase Orders (spec section 89): remaining receivable > 0 and
   * expected delivery date is before `asOfDate`. */
  async latePurchaseOrders(tenantId: string, membershipId: string, organizationId: string, asOfDate: Date) {
    const open = await this.openPurchaseOrders(tenantId, membershipId, organizationId);
    return open.filter((o) => o.expectedDeliveryDate && o.expectedDeliveryDate < asOfDate);
  }
}
