import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';
import { INVENTORY_COUNT_ADJUSTMENT_TYPE, stockLineKey } from './inventory-count.constants';
import { ResolvedScope } from './inventory-count-scope.service';
import { InventoryCountCostingService } from './inventory-count-costing.service';

export interface BalanceRow {
  lineKey: string;
  warehouseId: string;
  locationId: string | null;
  productId: string;
  batchId: string | null;
  serialId: string | null;
  ownershipType: string;
  ownerCounterpartyId: string | null;
  stockStatus: string;
  quantity: Decimal;
}

export interface PostSnapshotMovement {
  id: string;
  lineKey: string;
  warehouseId: string;
  locationId: string | null;
  productId: string;
  batchId: string | null;
  serialId: string | null;
  ownershipType: string;
  ownerCounterpartyId: string | null;
  stockStatus: string;
  quantity: Decimal;
  recordedAt: Date;
  effectiveDate: Date;
  movementType: string;
  registrarDocumentType: string;
  registrarDocumentId: string;
}

/**
 * InventorySnapshotService (spec sections 8-10, 102-103).
 *
 * Source of truth is ALWAYS the Phase 10 movement register
 * (`InventoryMovement`), aggregated set-based in one GROUP BY — never a
 * cached/UI stock figure and never a per-row query.
 *
 * Time axis ("movement cutoff", spec section 15): a movement belongs to
 * the snapshot iff it was RECORDED (`createdAt`) at or before
 * `snapshot_at`. The register's `effectiveDate` is a business *date*
 * (no time of day), so it cannot order an intraday snapshot against an
 * intraday receipt; the insertion timestamp can, deterministically. A
 * back-dated document posted after the snapshot is therefore correctly
 * treated as a post-snapshot movement.
 */
@Injectable()
export class InventorySnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: InventoryCountCostingService,
  ) {}

  /** `getInventoryBalance(asOf, dimensions...)` — authoritative balance of
   * every in-scope stock key as recorded up to `recordedUpTo`. */
  async getInventoryBalance(
    tenantId: string,
    organizationId: string,
    scope: ResolvedScope,
    recordedUpTo: Date,
    opts: { excludeDocumentIds?: string[] } = {},
    tx?: PrismaTransactionClient,
  ): Promise<BalanceRow[]> {
    const db = tx ?? this.prisma;
    const groups = await db.inventoryMovement.groupBy({
      by: ['warehouseId', 'locationId', 'productId', 'batchId', 'serialId', 'ownershipType', 'ownerCounterpartyId', 'stockStatus'],
      where: {
        tenantId,
        organizationId,
        ...scope.movementWhere(),
        stockStatus: { in: PHYSICAL_STOCK_STATUSES },
        createdAt: { lte: recordedUpTo },
        ...(opts.excludeDocumentIds && opts.excludeDocumentIds.length > 0 ? { NOT: { registrarDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, registrarDocumentId: { in: opts.excludeDocumentIds } } } : {}),
      },
      _sum: { baseQuantity: true },
    });
    const rows: BalanceRow[] = [];
    for (const g of groups) {
      const qty = new Decimal((g._sum.baseQuantity ?? 0).toString());
      if (!scope.matches(g)) continue;
      rows.push({
        lineKey: stockLineKey(g),
        warehouseId: g.warehouseId,
        locationId: g.locationId,
        productId: g.productId,
        batchId: g.batchId,
        serialId: g.serialId,
        ownershipType: g.ownershipType,
        ownerCounterpartyId: g.ownerCounterpartyId,
        stockStatus: g.stockStatus,
        quantity: qty,
      });
    }
    return rows;
  }

  /** Every in-scope movement recorded after `after` (and up to `until`),
   * excluding this session's own adjustment documents — the input of the
   * movement-aware reconciliation (spec sections 13-15, 63-66). */
  async getMovementsAfter(
    tenantId: string,
    organizationId: string,
    scope: ResolvedScope,
    after: Date,
    until: Date | null,
    excludeDocumentIds: string[],
    tx?: PrismaTransactionClient,
  ): Promise<PostSnapshotMovement[]> {
    const db = tx ?? this.prisma;
    const rows = await db.inventoryMovement.findMany({
      where: {
        tenantId,
        organizationId,
        ...scope.movementWhere(),
        stockStatus: { in: PHYSICAL_STOCK_STATUSES },
        createdAt: { gt: after, ...(until ? { lte: until } : {}) },
        ...(excludeDocumentIds.length > 0 ? { NOT: { registrarDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, registrarDocumentId: { in: excludeDocumentIds } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((m) => scope.matches(m))
      .map((m) => ({
        id: m.id,
        lineKey: stockLineKey(m),
        warehouseId: m.warehouseId,
        locationId: m.locationId,
        productId: m.productId,
        batchId: m.batchId,
        serialId: m.serialId,
        ownershipType: m.ownershipType,
        ownerCounterpartyId: m.ownerCounterpartyId,
        stockStatus: m.stockStatus,
        quantity: new Decimal(m.baseQuantity.toString()),
        recordedAt: m.createdAt,
        effectiveDate: m.effectiveDate,
        movementType: m.movementType,
        registrarDocumentType: m.registrarDocumentType,
        registrarDocumentId: m.registrarDocumentId,
      }));
  }

  /** Writes an immutable, versioned snapshot for the session. Costs are
   * resolved set-based (one query for all products). */
  async createSnapshot(
    tenantId: string,
    organizationId: string,
    sessionId: string,
    version: number,
    scope: ResolvedScope,
    snapshotAt: Date,
    tx: PrismaTransactionClient,
  ) {
    const balance = await this.getInventoryBalance(tenantId, organizationId, scope, snapshotAt, {}, tx);
    const nonZero = balance.filter((b) => !b.quantity.isZero());
    const productIds = Array.from(new Set(nonZero.map((b) => b.productId)));
    const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, baseUnitId: true } });
    const baseUnit = new Map(products.map((p) => [p.id, p.baseUnitId]));
    const costs = await this.costing.weightedAverageMap(tenantId, organizationId, productIds, snapshotAt, tx);

    const data = nonZero.map((b) => {
      const unitCost = costs.get(`${b.productId}|${b.warehouseId}`) ?? costs.get(`${b.productId}|*`) ?? null;
      return {
        tenantId,
        sessionId,
        snapshotVersion: version,
        lineKey: b.lineKey,
        organizationId,
        warehouseId: b.warehouseId,
        locationId: b.locationId,
        productId: b.productId,
        batchId: b.batchId,
        serialId: b.serialId,
        ownershipType: b.ownershipType,
        ownerCounterpartyId: b.ownerCounterpartyId,
        stockStatus: b.stockStatus,
        unitId: baseUnit.get(b.productId)!,
        accountingQuantity: b.quantity.toString(),
        baseQuantity: b.quantity.toString(),
        unitCost: unitCost ? unitCost.toString() : null,
        stockValue: unitCost ? unitCost.times(b.quantity).toDecimalPlaces(2).toString() : null,
        costingStatus: unitCost ? 'RESOLVED' : 'UNRESOLVED',
        snapshotAt,
      };
    });
    // Chunked bulk insert (spec section 102: batch snapshot generation).
    for (let i = 0; i < data.length; i += 1000) {
      await tx.inventoryCountSnapshotLine.createMany({ data: data.slice(i, i + 1000) });
    }
    return { lineCount: data.length, totalQuantity: nonZero.reduce((s, b) => s.plus(b.quantity), new Decimal(0)) };
  }

  lines(tenantId: string, sessionId: string, version: number, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    return db.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId, snapshotVersion: version }, orderBy: [{ warehouseId: 'asc' }, { locationId: 'asc' }, { productId: 'asc' }] });
  }
}
