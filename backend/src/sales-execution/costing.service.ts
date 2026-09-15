import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { SHIPMENT_TYPE } from './shipment.repository';

/**
 * CostingService interface (spec sections 36-38, 115) — now backed by the
 * real Phase 11 Inventory Costing Engine. `getUnitCost` resolves the
 * SalesInvoiceLine's linked `sourceShipmentLineId`, then reads back the
 * REALIZED FIFO/weighted-average unit cost `ShipmentPostingHandler`
 * already calculated at physical issue time (spec section 24) — it never
 * recomputes a cost here, so an invoice posted long after its shipment
 * still gets that shipment's own historical cost, not today's.
 * `null` still means "cost genuinely unavailable" (no shipment link, or
 * the shipment was never costed) — callers keep skipping the COGS
 * posting entirely for that line rather than fabricating one.
 */
@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: InventoryCostingService,
  ) {}

  async getUnitCost(
    tenantId: string,
    _organizationId: string,
    _productId: string,
    _warehouseId: string,
    _businessDate: Date,
    sourceShipmentLineId?: string,
  ): Promise<Decimal | null> {
    if (!sourceShipmentLineId) return null;
    return this.costing.getRealizedUnitCost(tenantId, SHIPMENT_TYPE, sourceShipmentLineId);
  }
}
