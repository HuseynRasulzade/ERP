import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { SHIPMENT_TYPE } from './shipment.repository';

/**
 * CostingService interface (spec sections 36-38, 115) — the seam
 * `SalesInvoicePostingHandler` calls for COGS. Now backed by the real
 * Phase 11 Inventory Costing Engine (`InventoryCostingService`) instead of
 * always returning `null`. `getUnitCost` stays as the coarse
 * product+warehouse+date fallback/reporting path; `getShipmentLineCost` is
 * the PRECISE path `buildCogsLines` prefers — it reads back the exact
 * `InventoryCostConsumption` rows the Shipment's own posting already
 * computed (spec section 24: costing happens at the physical stock-out
 * event), which is correct even when two shipments of the same
 * product/warehouse post on the same day at different FIFO costs, unlike a
 * coarse per-day average lookup. Either path returns `null` when the
 * organization has no costing policy configured — every caller still
 * treats `null` as "skip the COGS posting entirely for this line", per the
 * original disclosed convention.
 */
@Injectable()
export class CostingService {
  constructor(private readonly costing: InventoryCostingService) {}

  async getUnitCost(
    tenantId: string,
    organizationId: string,
    productId: string,
    warehouseId: string,
    businessDate: Date,
    tx?: PrismaTransactionClient,
  ): Promise<Decimal | null> {
    return this.costing.getUnitCost(tenantId, organizationId, productId, warehouseId, businessDate, tx);
  }

  async getShipmentLineCost(tenantId: string, shipmentLineId: string, tx?: PrismaTransactionClient): Promise<Decimal | null> {
    return this.costing.getConsumptionCostForLine(tenantId, SHIPMENT_TYPE, shipmentLineId, tx);
  }
}
