import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';
import { ValidationAppError } from '../common/errors/app-error';
import { InventoryCostingPolicyService } from '../inventory-costing/inventory-costing-policy.service';
import { CostingDimensionService } from '../inventory-costing/costing-dimension.service';

/**
 * InventorySnapshotService (spec sections 8-10, 103). Generates the
 * authoritative stock snapshot from Phase 10's own `InventoryMovement`
 * register in ONE grouped query per session (spec section 102 — never
 * per-row/per-product), never from a cached/UI-visible stock number
 * (spec section 9: "heç vaxt UI-də görünən cached stock rəqəmlərindən
 * alınmamalıdır"). Immutable once written (spec section 10) — there is
 * no update method here, only `generate` (blocked by
 * `InventoryCountSessionService` from running twice against the same
 * session, spec section 103's own "accidental duplicate snapshot"
 * concern).
 */
@Injectable()
export class InventorySnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly dimensions: CostingDimensionService,
  ) {}

  async generate(
    tenantId: string,
    organizationId: string,
    sessionId: string,
    snapshotVersion: number,
    snapshotAt: Date,
    scopeFilter: { warehouseIds?: string[]; productIds?: string[] } = {},
    tx: PrismaTransactionClient,
  ): Promise<number> {
    const existing = await tx.inventoryCountSnapshotLine.findFirst({ where: { tenantId, sessionId, snapshotVersion } });
    if (existing) throw new ValidationAppError(`Snapshot version ${snapshotVersion} already exists for this session — snapshots are immutable (spec section 10)`);

    // Single grouped aggregate query across every physical-stock dimension
    // (spec section 8) — Phase 10's InventoryMovement.quantity is signed,
    // so a plain SUM already nets IN/OUT correctly per group.
    const grouped = await tx.inventoryMovement.groupBy({
      by: ['warehouseId', 'locationId', 'productId', 'batchId', 'serialId', 'ownershipType', 'stockStatus', 'unitId'],
      where: {
        tenantId,
        organizationId,
        stockStatus: { in: PHYSICAL_STOCK_STATUSES },
        effectiveDate: { lte: snapshotAt },
        ...(scopeFilter.warehouseIds?.length ? { warehouseId: { in: scopeFilter.warehouseIds } } : {}),
        ...(scopeFilter.productIds?.length ? { productId: { in: scopeFilter.productIds } } : {}),
      },
      _sum: { quantity: true, baseQuantity: true },
    });

    const nonZero = grouped.filter((g) => new Decimal((g._sum.quantity ?? 0).toString()).abs().gt(0.000001));

    // Best-effort Phase 11 valuation enrichment (spec section 8's
    // "Optional: stock value, unit cost") — never blocks snapshot creation
    // if costing is unavailable for a dimension.
    const policy = await this.policies.resolve(tenantId, organizationId, snapshotAt, tx);

    let created = 0;
    for (const g of nonZero) {
      const costingKey = this.dimensions.resolveKey(policy, { organizationId, productId: g.productId, warehouseId: g.warehouseId, batchId: g.batchId });
      const layerAgg = await tx.inventoryCostLayer.aggregate({ where: { tenantId, costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } }, _sum: { remainingQuantity: true, currentRemainingValue: true } });
      const layerQty = new Decimal((layerAgg._sum.remainingQuantity ?? 0).toString());
      const layerValue = new Decimal((layerAgg._sum.currentRemainingValue ?? 0).toString());
      const unitCost = layerQty.gt(0) ? layerValue.div(layerQty) : null;

      await tx.inventoryCountSnapshotLine.create({
        data: {
          tenantId,
          sessionId,
          snapshotVersion,
          organizationId,
          warehouseId: g.warehouseId,
          locationId: g.locationId,
          productId: g.productId,
          batchId: g.batchId,
          serialId: g.serialId,
          ownershipType: g.ownershipType,
          qualityStatus: g.stockStatus,
          accountingQuantity: (g._sum.quantity ?? 0).toString(),
          baseQuantity: (g._sum.baseQuantity ?? 0).toString(),
          unitCost: unitCost?.toString(),
          stockValue: unitCost ? unitCost.mul(g._sum.quantity!.toString()).toDecimalPlaces(2).toString() : undefined,
          costingStatus: unitCost ? 'FINAL' : 'UNCALCULATED',
        },
      });
      created++;
    }

    return created;
  }

  /** Post-snapshot movement delta for a scope, honoring the configured
   * cutoff mode (spec sections 14-15, 63-66). `cutoffAt` is either the
   * global session cutoff or a per-location/task completion timestamp. */
  async postSnapshotDelta(tenantId: string, dims: { warehouseId: string; locationId?: string | null; productId: string; batchId?: string | null; ownershipType?: string; qualityStatus?: string }, fromExclusive: Date, toInclusive: Date): Promise<Decimal> {
    const agg = await this.prisma.inventoryMovement.aggregate({
      where: {
        tenantId,
        warehouseId: dims.warehouseId,
        locationId: dims.locationId ?? undefined,
        productId: dims.productId,
        batchId: dims.batchId ?? undefined,
        ownershipType: dims.ownershipType,
        stockStatus: dims.qualityStatus,
        effectiveDate: { gt: fromExclusive, lte: toInclusive },
      },
      _sum: { quantity: true },
    });
    return new Decimal((agg._sum.quantity ?? 0).toString());
  }
}
