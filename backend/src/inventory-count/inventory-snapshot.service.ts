import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

type MovementWhere = Prisma.InventoryMovementWhereInput;

/**
 * InventorySnapshotService (spec sections 8-10) — the authoritative,
 * IMMUTABLE "what the books say we have" figure a count is measured
 * against. Built once, from Phase 10's InventoryMovement register (never
 * a cached UI balance), grouped by the FULL dimension tuple (warehouse,
 * location, product, batch, serial, ownership, quality/physical status) —
 * collapsing to product level here would hide exactly the batch/location
 * mismatches variance calculation exists to catch (spec section 33).
 *
 * A plan's `InventoryCountScope` rows (INCLUDE first, then EXCLUDE
 * subtracted) decide which movements are in scope; once written, this
 * table is never updated — `InventoryCountPlanService`/`ScopeService`
 * enforce that a session leaving DRAFT freezes the scope that produced it.
 */
@Injectable()
export class InventorySnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: InventoryCostingService,
  ) {}

  async generate(tenantId: string, organizationId: string, sessionId: string, cutoffDate: Date, tx: PrismaTransactionClient): Promise<number> {
    const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    const existing = await tx.inventoryCountSnapshotLine.count({ where: { tenantId, sessionId } });
    if (existing > 0) throw new ValidationAppError('This count session already has a snapshot — a snapshot is written once and never regenerated');

    const scopes = await tx.inventoryCountScope.findMany({ where: { tenantId, inventoryCountPlanId: session.inventoryCountPlanId } });
    if (scopes.length === 0) throw new ValidationAppError('Count session cannot start because no inventory scope has been defined');

    const includeClauses: MovementWhere[] = [];
    const excludeClauses: MovementWhere[] = [];
    for (const scope of scopes) {
      const clause = await this.scopeRowToWhere(tx, tenantId, scope);
      if (scope.includeExclude === 'EXCLUDE') excludeClauses.push(clause);
      else includeClauses.push(clause);
    }

    const where: MovementWhere = {
      tenantId,
      organizationId,
      effectiveDate: { lte: cutoffDate },
      stockStatus: { in: PHYSICAL_STOCK_STATUSES },
      ...(includeClauses.length > 0 ? { OR: includeClauses } : {}),
      ...(excludeClauses.length > 0 ? { NOT: { OR: excludeClauses } } : {}),
    };

    const grouped = await tx.inventoryMovement.groupBy({
      by: ['warehouseId', 'locationId', 'productId', 'batchId', 'serialId', 'ownershipType', 'stockStatus'],
      where,
      _sum: { baseQuantity: true },
    });

    const productIds = [...new Set(grouped.map((g) => g.productId))];
    const products = productIds.length > 0 ? await tx.product.findMany({ where: { id: { in: productIds }, tenantId } }) : [];
    const baseUnitByProduct = new Map(products.map((p) => [p.id, p.baseUnitId]));

    let written = 0;
    for (const g of grouped) {
      const quantity = new Decimal((g._sum.baseQuantity ?? 0).toString());
      if (quantity.isZero()) continue;
      const unitId = baseUnitByProduct.get(g.productId);
      if (!unitId) continue;

      const unitCost = await this.costing.getUnitCost(tenantId, organizationId, g.productId, g.warehouseId, cutoffDate, tx);
      const inventoryValue = unitCost ? quantity.times(unitCost) : null;

      await tx.inventoryCountSnapshotLine.create({
        data: {
          tenantId,
          sessionId,
          warehouseId: g.warehouseId,
          locationId: g.locationId,
          productId: g.productId,
          batchId: g.batchId,
          serialId: g.serialId,
          ownershipType: g.ownershipType,
          qualityStatus: g.stockStatus,
          unitId,
          accountingQuantity: quantity.toString(),
          unitCost: unitCost ? unitCost.toString() : null,
          inventoryValue: inventoryValue ? inventoryValue.toString() : null,
          costingStatus: unitCost ? 'COSTED' : 'UNCOSTED',
        },
      });
      written += 1;
    }

    return written;
  }

  private async scopeRowToWhere(tx: PrismaTransactionClient, tenantId: string, scope: { warehouseId: string | null; locationId: string | null; locationSubtree: boolean; productId: string | null; productGroupId: string | null; batchId: string | null; serialId: string | null; ownershipType: string | null; qualityStatus: string | null }): Promise<MovementWhere> {
    const where: MovementWhere = {};
    if (scope.warehouseId) where.warehouseId = scope.warehouseId;
    if (scope.locationId) {
      where.locationId = scope.locationSubtree ? { in: await this.resolveLocationSubtreeIds(tx, tenantId, scope.locationId) } : scope.locationId;
    }
    if (scope.productId) where.productId = scope.productId;
    if (scope.productGroupId) where.product = { categoryId: scope.productGroupId };
    if (scope.batchId) where.batchId = scope.batchId;
    if (scope.serialId) where.serialId = scope.serialId;
    if (scope.ownershipType) where.ownershipType = scope.ownershipType;
    if (scope.qualityStatus) where.stockStatus = scope.qualityStatus;
    return where;
  }

  private async resolveLocationSubtreeIds(tx: PrismaTransactionClient, tenantId: string, rootLocationId: string): Promise<string[]> {
    const all: string[] = [rootLocationId];
    let frontier = [rootLocationId];
    while (frontier.length > 0) {
      const children = await tx.warehouseLocation.findMany({ where: { tenantId, parentLocationId: { in: frontier } }, select: { id: true } });
      const childIds = children.map((c) => c.id).filter((id) => !all.includes(id));
      if (childIds.length === 0) break;
      all.push(...childIds);
      frontier = childIds;
    }
    return all;
  }
}
