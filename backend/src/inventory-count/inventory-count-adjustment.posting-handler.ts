import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { NegativeStockBlockedError, ValidationAppError } from '../common/errors/app-error';
import { InventoryMovementService } from '../warehouse-inventory/inventory-movement.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { INVENTORY_COUNT_ADJUSTMENT_TYPE, InventoryCountMappingKeys, dec, decOrNull } from './inventory-count.constants';
import { CountCostingUnresolvedError, CountInvalidStateError } from './inventory-count.errors';
import { InventoryCountCostingService } from './inventory-count-costing.service';

type AdjustmentWithLines = NonNullable<Awaited<ReturnType<InventoryCountAdjustmentPostingHandler['load']>>>;
type Line = AdjustmentWithLines['lines'][number];

interface Leg {
  line: Line;
  sign: 1 | -1;
  locationId: string | null;
  batchId: string | null;
  serialId: string | null;
  stockStatus: string;
  movementType: string;
}

/**
 * Posting handler for INVENTORY_COUNT_ADJUSTMENT (spec sections 51-58).
 *
 * Inside the single document-framework posting transaction:
 *   validate  — session approved, per-leg stock availability (under the
 *               Phase 10 advisory stock lock), cost determination for
 *               surplus/shortage lines (STRICT: an unresolved shortage
 *               cost blocks the post; never a silent zero)
 *   movements — Phase 10 quantity movements through InventoryMovementService:
 *               INVENTORY_SURPLUS → IN, INVENTORY_SHORTAGE → OUT, and
 *               OUT+IN pairs for location/status/batch/serial corrections;
 *               each movement carries the line's unit cost as its
 *               `provisionalCost` (the Phase 11 value handoff)
 *   GL        — Phase 4 balanced entry via semantic mappings (never a
 *               literal account): surplus Dr Inventory / Cr Inventory
 *               Surplus Income; shortage Dr Shortage Expense (or the
 *               recoverable-from-employee account for the responsible
 *               person's portion) / Cr Inventory. Corrections are value
 *               neutral (no journal entry).
 * The document-framework's already-posted check + the unique posting key
 * make the post idempotent; any failure rolls everything back.
 */
@Injectable()
export class InventoryCountAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_COUNT_ADJUSTMENT_TYPE;

  constructor(
    private readonly movements: InventoryMovementService,
    private readonly mappings: AccountingMappingService,
    private readonly costing: InventoryCountCostingService,
  ) {}

  load(tenantId: string, id: string, tx: PrismaTransactionClient) {
    return tx.inventoryCountAdjustment.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { position: 'asc' } }, session: { include: { plan: true } } } });
  }

  private legs(adj: AdjustmentWithLines): Leg[] {
    const legs: Leg[] = [];
    for (const line of adj.lines) {
      const base = { line, locationId: line.locationId, batchId: line.batchId, serialId: line.serialId, stockStatus: line.stockStatus };
      switch (adj.operationType) {
        case 'INVENTORY_SURPLUS':
          legs.push({ ...base, sign: 1, movementType: 'INVENTORY_SURPLUS' });
          break;
        case 'INVENTORY_SHORTAGE':
          legs.push({ ...base, sign: -1, movementType: 'INVENTORY_SHORTAGE' });
          break;
        default: {
          legs.push({ ...base, sign: -1, movementType: `${adj.operationType}_OUT` });
          legs.push({
            line,
            sign: 1,
            movementType: `${adj.operationType}_IN`,
            locationId: adj.operationType === 'LOCATION_CORRECTION' ? line.toLocationId : line.locationId,
            batchId: adj.operationType === 'BATCH_CORRECTION' ? line.toBatchId : line.batchId,
            serialId: adj.operationType === 'SERIAL_CORRECTION' ? line.toSerialId : line.serialId,
            stockStatus: adj.operationType === 'STATUS_CORRECTION' ? line.toStockStatus ?? line.stockStatus : line.stockStatus,
          });
        }
      }
    }
    return legs;
  }

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await this.load(tenantId, document.id, tx);
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    if (adj.status === 'CANCELLED') throw new ValidationAppError('Cannot post a cancelled inventory count adjustment');
    if (adj.lines.length === 0) throw new ValidationAppError('Cannot post an inventory count adjustment with no lines');
    if (adj.session.status !== 'APPROVED') throw new CountInvalidStateError(`Inventory count session ${adj.session.sessionNumber} is ${adj.session.status}; adjustments post only from an APPROVED session.`);
    if (!['APPROVED', 'NOT_REQUIRED'].includes(adj.session.approvalStatus)) throw new CountInvalidStateError('Inventory count variances are not approved.');

    const warehouse = await tx.warehouse.findFirstOrThrow({ where: { id: adj.warehouseId } });
    for (const leg of this.legs(adj).filter((l) => l.sign < 0)) {
      await this.movements.lockStockKey(tx, tenantId, adj.warehouseId, leg.line.productId, leg.batchId);
      if (warehouse.allowNegativeStock) continue;
      const agg = await tx.inventoryMovement.aggregate({
        where: {
          tenantId,
          warehouseId: adj.warehouseId,
          productId: leg.line.productId,
          locationId: leg.locationId,
          batchId: leg.batchId,
          serialId: leg.serialId,
          ownershipType: leg.line.ownershipType,
          ownerCounterpartyId: leg.line.ownerCounterpartyId,
          stockStatus: leg.stockStatus,
        },
        _sum: { baseQuantity: true },
      });
      const onHand = new Decimal((agg._sum.baseQuantity ?? 0).toString());
      if (onHand.lt(dec(leg.line.quantity))) {
        const product = await tx.product.findFirst({ where: { id: leg.line.productId }, select: { code: true } });
        throw new NegativeStockBlockedError(warehouse.code, product?.code ?? leg.line.productId, onHand.toFixed(6), dec(leg.line.quantity).toFixed(6));
      }
    }

    // Cost determination (spec sections 34-36, 55, 128).
    if (adj.operationType !== 'INVENTORY_SURPLUS' && adj.operationType !== 'INVENTORY_SHORTAGE') return;
    const plan = adj.session.plan;
    const direction = adj.operationType === 'INVENTORY_SURPLUS' ? 'SURPLUS' : 'SHORTAGE';
    const policy = direction === 'SURPLUS' ? plan.surplusCostPolicy : plan.shortageCostPolicy;
    let total = new Decimal(0);
    for (const line of adj.lines) {
      const res = await this.costing.resolveUnitCost(tenantId, adj.organizationId, { productId: line.productId, warehouseId: adj.warehouseId, asOf: new Date(), quantity: dec(line.quantity), approvedCost: decOrNull(line.approvedCost) }, direction, policy, tx);
      if (res.status === 'UNRESOLVED' && plan.costingStrictness === 'STRICT') {
        const product = await tx.product.findFirst({ where: { id: line.productId }, select: { code: true } });
        if (direction === 'SHORTAGE') throw new CountCostingUnresolvedError(product?.code ?? line.productId);
        throw new ValidationAppError(`Surplus of ${product?.code ?? line.productId} cannot be valued under policy ${policy}; approve a cost or choose another surplus costing policy.`);
      }
      const amount = res.unitCost ? res.unitCost.times(dec(line.quantity)).toDecimalPlaces(2) : null;
      if (amount) total = total.plus(amount);
      await tx.inventoryCountAdjustmentLine.update({ where: { id: line.id }, data: { unitCost: res.unitCost?.toString() ?? null, amount: amount?.toString() ?? null, costSource: res.source, costingStatus: res.status } });
    }
    await tx.inventoryCountAdjustment.update({ where: { id: adj.id }, data: { totalValue: total.toString() } });
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adj = await this.load(tenantId, document.id, tx);
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const createdBy = document.postedBy ?? document.createdBy ?? undefined;

    for (const leg of this.legs(adj)) {
      const qty = dec(leg.line.quantity);
      await this.movements.recordMovement(
        tenantId,
        {
          organizationId: adj.organizationId,
          warehouseId: adj.warehouseId,
          locationId: leg.locationId,
          productId: leg.line.productId,
          unitId: leg.line.unitId,
          batchId: leg.batchId,
          serialId: leg.serialId,
          ownershipType: leg.line.ownershipType,
          ownerCounterpartyId: leg.line.ownerCounterpartyId,
          stockStatus: leg.stockStatus,
          movementType: leg.movementType,
          quantity: leg.sign < 0 ? qty.negated() : qty,
          baseQuantity: leg.sign < 0 ? qty.negated() : qty,
          effectiveDate: businessDate,
          registrarDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE,
          registrarDocumentId: adj.id,
          registrarLineId: leg.line.id,
          provisionalCost: leg.line.unitCost != null ? dec(leg.line.unitCost) : null,
          createdBy,
        },
        tx,
      );
      if (leg.serialId) {
        await tx.serialNumber.update({
          where: { id: leg.serialId },
          data: leg.sign > 0 ? { status: 'AVAILABLE', currentWarehouseId: adj.warehouseId, currentLocationId: leg.locationId } : { status: 'MISSING', currentWarehouseId: null, currentLocationId: null },
        });
      }
    }
    await tx.inventoryMovement.updateMany({ where: { tenantId, registrarDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, registrarDocumentId: adj.id }, data: { costingStatus: adj.lines.some((l) => l.costingStatus === 'PENDING_VALUATION') ? 'PENDING_VALUATION' : 'COSTED' } });

    if (adj.operationType !== 'INVENTORY_SURPLUS' && adj.operationType !== 'INVENTORY_SHORTAGE') return null;
    const valued = adj.lines.filter((l) => l.amount != null && dec(l.amount).gt(0));
    if (valued.length === 0) return null;

    const inventory = await this.mappings.resolve(tenantId, adj.organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const lines: AccountingPostingLineInput[] = [];
    const dims = (l: Line) => [
      { dimensionCode: 'WAREHOUSE', referenceId: adj.warehouseId },
      { dimensionCode: 'PRODUCT', referenceId: l.productId },
    ];
    if (adj.operationType === 'INVENTORY_SURPLUS') {
      const income = await this.resolveWithFallback(tenantId, adj.organizationId, [InventoryCountMappingKeys.SURPLUS_INCOME, MappingKeys.OTHER_OPERATING_INCOME], businessDate, tx);
      for (const l of valued) {
        const amount = dec(l.amount);
        lines.push({ accountId: inventory.id, side: 'DEBIT', amountBase: amount, quantity: dec(l.quantity), quantityUnitId: l.unitId, description: `Inventory surplus — ${adj.number}`, sourceDocumentLineId: l.id, dimensions: dims(l) });
        lines.push({ accountId: income.id, side: 'CREDIT', amountBase: amount, description: `Inventory surplus income — ${adj.number}`, sourceDocumentLineId: l.id, dimensions: dims(l) });
      }
    } else {
      const expense = await this.resolveWithFallback(tenantId, adj.organizationId, [InventoryCountMappingKeys.SHORTAGE_EXPENSE, MappingKeys.OTHER_OPERATING_EXPENSE], businessDate, tx);
      for (const l of valued) {
        const amount = dec(l.amount);
        const recoverable = l.responsibleEmployeeId && l.recoverableAmount ? Decimal.min(dec(l.recoverableAmount), amount) : new Decimal(0);
        if (recoverable.gt(0)) {
          const receivable = await this.resolveWithFallback(tenantId, adj.organizationId, [InventoryCountMappingKeys.SHORTAGE_RECOVERABLE, InventoryCountMappingKeys.SHORTAGE_EXPENSE, MappingKeys.OTHER_OPERATING_EXPENSE], businessDate, tx);
          lines.push({ accountId: receivable.id, side: 'DEBIT', amountBase: recoverable, description: `Shortage recoverable from responsible person — ${adj.number}`, sourceDocumentLineId: l.id, dimensions: dims(l) });
        }
        if (amount.minus(recoverable).gt(0)) {
          lines.push({ accountId: expense.id, side: 'DEBIT', amountBase: amount.minus(recoverable), description: `Inventory shortage expense — ${adj.number}`, sourceDocumentLineId: l.id, dimensions: dims(l) });
        }
        lines.push({ accountId: inventory.id, side: 'CREDIT', amountBase: amount, quantity: dec(l.quantity), quantityUnitId: l.unitId, description: `Inventory shortage — ${adj.number}`, sourceDocumentLineId: l.id, dimensions: dims(l) });
      }
    }
    return { description: `Inventory count adjustment ${adj.number} (${adj.session.sessionNumber})`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await this.load(tenantId, document.id, tx);
    if (!adj) return;
    if (['RECONCILED', 'CLOSED'].includes(adj.session.status)) {
      throw new CountInvalidStateError(`Inventory count session ${adj.session.sessionNumber} is ${adj.session.status}; its adjustments can no longer be reversed.`);
    }
    for (const leg of this.legs(adj)) {
      if (!leg.serialId) continue;
      await tx.serialNumber.update({
        where: { id: leg.serialId },
        data: leg.sign > 0 ? { status: 'MISSING', currentWarehouseId: null, currentLocationId: null } : { status: 'AVAILABLE', currentWarehouseId: adj.warehouseId, currentLocationId: leg.locationId },
      });
    }
    await this.movements.deleteMovementsFor(tenantId, INVENTORY_COUNT_ADJUSTMENT_TYPE, document.id, tx);
    // Controlled reversal: the session drops back to APPROVED so the
    // adjustment can be re-posted (or the session cancelled).
    if (adj.session.status === 'POSTED') {
      await tx.inventoryCountSession.update({ where: { id: adj.sessionId }, data: { status: 'APPROVED', postedAt: null, version: { increment: 1 } } });
      await tx.inventoryVariance.updateMany({ where: { tenantId, sessionId: adj.sessionId, resolutionStatus: 'POSTED' }, data: { resolutionStatus: 'APPROVED' } });
    }
  }

  private async resolveWithFallback(tenantId: string, organizationId: string, keys: string[], date: Date, tx: PrismaTransactionClient) {
    let lastError: unknown;
    for (const key of keys) {
      try {
        return await this.mappings.resolve(tenantId, organizationId, key, date, tx);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}

