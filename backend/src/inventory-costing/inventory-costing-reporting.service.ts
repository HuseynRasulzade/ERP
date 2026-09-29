import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * InventoryCostingReportingService (spec sections 76, 78, 80, 82) — read
 * models over the cost register/layers, never a stored, mutable
 * "current value" field (spec section 2's own rule). Kept deliberately
 * simple (no UI in this build, matching every other Phase 7-10 module) —
 * the reporting-grade subset the spec's acceptance criteria actually
 * exercise: valuation, COGS, FIFO layer drill-down, and a costing health
 * check.
 */
@Injectable()
export class InventoryCostingReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Inventory Valuation report (spec section 76) — current quantity/value
   * per costing key, derived live from the cost movement register. */
  async valuation(tenantId: string, organizationId: string, filters: { warehouseId?: string; productId?: string } = {}) {
    const grouped = await this.prisma.inventoryCostMovement.groupBy({
      by: ['costingKey', 'productId', 'warehouseId'],
      where: { tenantId, organizationId, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}), ...(filters.productId ? { productId: filters.productId } : {}) },
      _sum: { quantity: true, totalCost: true },
    });

    return grouped.map((g) => {
      const quantity = new Decimal(g._sum.quantity?.toString() ?? 0);
      const value = new Decimal(g._sum.totalCost?.toString() ?? 0);
      return {
        costingKey: g.costingKey,
        productId: g.productId,
        warehouseId: g.warehouseId,
        quantity: quantity.toString(),
        value: value.toString(),
        unitCost: quantity.gt(0) ? value.div(quantity).toString() : null,
      };
    });
  }

  /** Inventory Valuation as of a historical date (spec section 77) — the
   * same aggregate, filtered to movements up to and including that date. */
  async valuationAsOf(tenantId: string, organizationId: string, asOfDate: Date, filters: { warehouseId?: string; productId?: string } = {}) {
    const grouped = await this.prisma.inventoryCostMovement.groupBy({
      by: ['costingKey', 'productId', 'warehouseId'],
      where: { tenantId, organizationId, effectiveDate: { lte: asOfDate }, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}), ...(filters.productId ? { productId: filters.productId } : {}) },
      _sum: { quantity: true, totalCost: true },
    });
    return grouped.map((g) => {
      const quantity = new Decimal(g._sum.quantity?.toString() ?? 0);
      const value = new Decimal(g._sum.totalCost?.toString() ?? 0);
      return { costingKey: g.costingKey, productId: g.productId, warehouseId: g.warehouseId, quantity: quantity.toString(), value: value.toString() };
    });
  }

  /** COGS report (spec section 78) — every SHIPMENT-sourced outgoing cost
   * movement in the window, joined back to the Shipment line for context. */
  async cogsReport(tenantId: string, organizationId: string, from?: Date, to?: Date) {
    const rows = await this.prisma.inventoryCostMovement.findMany({
      where: {
        tenantId,
        organizationId,
        sourceDocumentType: 'SHIPMENT',
        quantity: { lt: 0 },
        ...(from || to ? { effectiveDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { effectiveDate: 'asc' },
    });
    return rows.map((r) => ({
      date: r.effectiveDate,
      productId: r.productId,
      warehouseId: r.warehouseId,
      quantity: new Decimal(r.quantity.toString()).abs().toString(),
      cogs: new Decimal(r.totalCost.toString()).abs().toString(),
      costStatus: r.costStatus,
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentLineId: r.sourceDocumentLineId,
    }));
  }

  /** FIFO cost layer report (spec section 80) — drill-down per layer. */
  async layerReport(tenantId: string, organizationId: string, filters: { productId?: string; warehouseId?: string; status?: string } = {}) {
    const layers = await this.prisma.inventoryCostLayer.findMany({
      where: { tenantId, organizationId, ...(filters.productId ? { productId: filters.productId } : {}), ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
      include: { consumptions: true, components: true },
    });
    return layers.map((l) => ({
      id: l.id,
      productId: l.productId,
      warehouseId: l.warehouseId,
      receiptDocumentType: l.sourceReceiptDocumentType,
      receiptDocumentId: l.sourceReceiptDocumentId,
      receiptDate: l.receiptDate,
      originalQuantity: l.originalQuantity.toString(),
      remainingQuantity: l.remainingQuantity.toString(),
      originalUnitCost: l.originalUnitCost.toString(),
      currentUnitCost: l.currentUnitCost.toString(),
      currentRemainingValue: l.currentRemainingValue.toString(),
      status: l.status,
      consumedBy: l.consumptions.map((c) => ({ outgoingDocumentType: c.outgoingDocumentType, outgoingDocumentId: c.outgoingDocumentId, consumedQuantity: c.consumedQuantity.toString(), consumedCost: c.consumedCost.toString() })),
      adjustments: l.components.map((c) => ({ componentType: c.componentType, amount: c.amount.toString(), sourceDocumentType: c.sourceDocumentType, sourceDocumentId: c.sourceDocumentId })),
    }));
  }

  /**
   * Costing Health report (spec section 82) — the minimum checks: negative
   * quantity, unresolved errors, pending recalculation, provisional
   * movements, quantity/cost-layer reconciliation, and (see
   * `uncostedInventoryMovements` below) movements the costing engine never
   * processed at all.
   */
  async health(tenantId: string, organizationId: string) {
    const [negativeLayers, pendingRecalc, unresolvedErrors, provisionalMovements] = await Promise.all([
      this.prisma.inventoryCostLayer.count({ where: { tenantId, organizationId, remainingQuantity: { lt: 0 } } }),
      this.prisma.inventoryCostRecalculationQueue.count({ where: { tenantId, organizationId, status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.inventoryCostingError.findMany({ where: { tenantId, organizationId, resolved: false }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.inventoryCostMovement.count({ where: { tenantId, organizationId, costStatus: 'PROVISIONAL' } }),
    ]);

    const zeroQuantityWithValue = await this.zeroQuantityWithValueCostingKeys(tenantId, organizationId);
    const uncosted = await this.uncostedInventoryMovements(tenantId, organizationId);

    return {
      negativeRemainingLayers: negativeLayers,
      pendingRecalculations: pendingRecalc,
      provisionalCostMovements: provisionalMovements,
      unresolvedErrors: unresolvedErrors.map((e) => ({ id: e.id, errorCode: e.errorCode, description: e.description, severity: e.severity, blocking: e.blocking, sourceDocumentType: e.sourceDocumentType, sourceDocumentId: e.sourceDocumentId })),
      zeroQuantityWithValueCostingKeys: zeroQuantityWithValue,
      uncostedMovementsBeforeAnyPolicy: uncosted.beforeAnyPolicy,
      uncostedMovementsWithActivePolicy: uncosted.withActivePolicy,
      healthy:
        negativeLayers === 0 &&
        pendingRecalc === 0 &&
        unresolvedErrors.filter((e) => e.blocking).length === 0 &&
        zeroQuantityWithValue.length === 0 &&
        uncosted.withActivePolicy === 0,
    };
  }

  /**
   * Uncosted `InventoryMovement` rows (`costingStatus IS NULL`) — this
   * codebase's own disclosed gap: `InventoryCostingService.receiveCost`/
   * `consumeCost` are a complete no-op for any movement dated before the
   * organization's FIRST costing policy was ever adopted, and — unlike a
   * backdated movement that lands within an already-costed window — that
   * gap is never retroactively closed by `InventoryCostRecalculationService`
   * (it only rebuilds from `InventoryCostMovement` rows that already
   * exist; a movement the engine skipped never wrote one). Split into two
   * buckets so the expected, disclosed case (dated before any policy ever
   * existed) doesn't read as unhealthy, while a movement dated ON OR AFTER
   * the earliest policy — which the engine SHOULD have costed and, for
   * some other reason (e.g. a document type not yet wired into this
   * module, such as Purchase Return-to-supplier — see docs/
   * INVENTORY_COSTING.md), did not — genuinely fails the health check.
   */
  private async uncostedInventoryMovements(tenantId: string, organizationId: string): Promise<{ beforeAnyPolicy: number; withActivePolicy: number }> {
    const earliestPolicy = await this.prisma.inventoryCostingPolicy.findFirst({
      where: { tenantId, organizationId },
      orderBy: { effectiveFrom: 'asc' },
    });

    const uncostedWhere = { tenantId, organizationId, costingStatus: null } as const;
    if (!earliestPolicy) {
      const total = await this.prisma.inventoryMovement.count({ where: uncostedWhere });
      return { beforeAnyPolicy: total, withActivePolicy: 0 };
    }

    const [beforeAnyPolicy, withActivePolicy] = await Promise.all([
      this.prisma.inventoryMovement.count({ where: { ...uncostedWhere, effectiveDate: { lt: earliestPolicy.effectiveFrom } } }),
      this.prisma.inventoryMovement.count({ where: { ...uncostedWhere, effectiveDate: { gte: earliestPolicy.effectiveFrom } } }),
    ]);
    return { beforeAnyPolicy, withActivePolicy };
  }

  /** Quantity/value consistency (spec sections 65-66): a costing key with
   * ~zero cumulative quantity but non-zero remaining value. */
  private async zeroQuantityWithValueCostingKeys(tenantId: string, organizationId: string): Promise<string[]> {
    const grouped = await this.prisma.inventoryCostMovement.groupBy({ by: ['costingKey'], where: { tenantId, organizationId }, _sum: { quantity: true, totalCost: true } });
    return grouped
      .filter((g) => new Decimal(g._sum.quantity?.toString() ?? 0).abs().lt('0.000001') && new Decimal(g._sum.totalCost?.toString() ?? 0).abs().gt('0.01'))
      .map((g) => g.costingKey);
  }
}
