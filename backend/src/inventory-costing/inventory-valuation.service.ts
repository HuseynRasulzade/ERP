import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface ValuationRow {
  costingKey: string;
  productId: string;
  warehouseId: string | null;
  quantity: string;
  value: string;
  averageUnitCost: string;
  costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
}

/**
 * InventoryValuationService (spec sections 76-77, 114-115). Reads from
 * `InventoryCostLayer` (both FIFO layers and the single WAC "bucket"
 * layer share the same table, see WeightedAverageEngine) — never from
 * Phase 10's own quantity register, since the two are allowed to diverge
 * (consignment stock, spec section 7) and this service answers "what is
 * it worth", not "how many units".
 */
@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current valuation — one row per open costing key. */
  async valuation(tenantId: string, filters: { organizationId?: string; warehouseId?: string; productId?: string }): Promise<ValuationRow[]> {
    const layers = await this.prisma.inventoryCostLayer.findMany({
      where: {
        tenantId,
        organizationId: filters.organizationId,
        warehouseId: filters.warehouseId,
        productId: filters.productId,
        status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] },
        remainingQuantity: { gt: 0 },
      },
    });

    const grouped = new Map<string, { productId: string; warehouseId: string | null; quantity: Decimal; value: Decimal; method: 'FIFO' | 'WEIGHTED_AVERAGE' }>();
    for (const l of layers) {
      const method = l.sourceDocumentType === 'WAC_BUCKET' ? 'WEIGHTED_AVERAGE' : 'FIFO';
      const key = l.costingKey;
      const entry = grouped.get(key) ?? { productId: l.productId, warehouseId: l.warehouseId, quantity: new Decimal(0), value: new Decimal(0), method };
      entry.quantity = entry.quantity.plus(l.remainingQuantity.toString());
      entry.value = entry.value.plus(l.currentRemainingValue.toString());
      grouped.set(key, entry);
    }

    return Array.from(grouped.entries()).map(([costingKey, v]) => ({
      costingKey,
      productId: v.productId,
      warehouseId: v.warehouseId,
      quantity: v.quantity.toString(),
      value: v.value.toDecimalPlaces(2).toString(),
      averageUnitCost: v.quantity.gt(0) ? v.value.div(v.quantity).toString() : '0',
      costingMethod: v.method,
    }));
  }

  /** Historical "as of date" valuation (spec section 77) — replays
   * InventoryCostMovement rows up to and including `asOfDate` rather than
   * multiplying today's cost by a historical quantity. Grouped by
   * costingKey; a costing key with no movement on/before the date is
   * simply absent (zero). */
  async valuationAsOf(tenantId: string, asOfDate: Date, filters: { organizationId?: string; warehouseId?: string; productId?: string }): Promise<ValuationRow[]> {
    const movements = await this.prisma.inventoryCostMovement.findMany({
      where: { tenantId, organizationId: filters.organizationId, warehouseId: filters.warehouseId, productId: filters.productId, effectiveDate: { lte: asOfDate } },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });

    const balances = new Map<string, { productId: string; warehouseId: string | null; quantity: Decimal; value: Decimal }>();
    for (const m of movements) {
      const entry = balances.get(m.costingKey) ?? { productId: m.productId, warehouseId: m.warehouseId, quantity: new Decimal(0), value: new Decimal(0) };
      entry.quantity = entry.quantity.plus(m.quantity.toString());
      entry.value = entry.value.plus(m.totalCost.toString());
      balances.set(m.costingKey, entry);
    }

    return Array.from(balances.entries())
      .filter(([, v]) => v.quantity.gt(0))
      .map(([costingKey, v]) => ({
        costingKey,
        productId: v.productId,
        warehouseId: v.warehouseId,
        quantity: v.quantity.toString(),
        value: v.value.toDecimalPlaces(2).toString(),
        averageUnitCost: v.quantity.gt(0) ? v.value.div(v.quantity).toString() : '0',
        costingMethod: 'FIFO' as const, // historical replay is method-agnostic; the label is informational only
      }));
  }

  /** Drill-down (spec sections 75, 84, 114) — from a costing key all the
   * way to the layer, its components, and its consumption. */
  async layerTrace(tenantId: string, costingKey: string) {
    const layers = await this.prisma.inventoryCostLayer.findMany({
      where: { tenantId, costingKey },
      include: { components: true, consumptions: { where: { reversed: false } } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
    });
    return layers;
  }
}
