import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CostingPolicyService } from './costing-policy.service';
import { FifoCostingStrategy } from './fifo-costing.strategy';
import { WeightedAverageCostingStrategy } from './weighted-average-costing.strategy';
import { CostEventContext } from './costing-strategy.interface';

export interface RecalculationRunResult {
  runId: string | null;
  processedKeys: number;
  adjustmentsCreated: number;
}

/**
 * InventoryCostRecalculationService (spec sections 46-49, 127, 131) —
 * processes `InventoryCostRecalculationQueue` entries `flagIfBackdated`
 * queued. Performs a FULL REBUILD of each affected costing key (a
 * disclosed simplification of "start at the earliest affected date only" —
 * spec section 47's own performance guidance — always correct since it
 * replays every `InventoryCostMovement` for that key from scratch, just
 * not the leanest possible incremental version; correctness over
 * performance per spec section 105).
 *
 * For every outgoing (consuming) movement whose recomputed cost differs
 * from what was originally recorded, this creates a DRAFT
 * `InventoryCostAdjustment` line (reason `SYSTEM_RECALCULATION`) rather
 * than silently rewriting history or guessing whether the original GL
 * consequence already posted — spec section 138's "calculation errors-ı
 * silent ignore etmə" extended to deltas: always surface, a human decides
 * whether/how to post the correction (`InventoryCostAdjustmentPostingHandler`
 * turns a posted adjustment into the real Dr/Cr entry).
 */
@Injectable()
export class InventoryCostRecalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: CostingPolicyService,
    private readonly fifo: FifoCostingStrategy,
    private readonly averageStrategy: WeightedAverageCostingStrategy,
  ) {}

  async processPendingQueue(tenantId: string, organizationId: string, userId: string): Promise<RecalculationRunResult> {
    return this.prisma.runInTransaction((tx) => this.processPendingQueueTx(tenantId, organizationId, userId, tx));
  }

  private async processPendingQueueTx(tenantId: string, organizationId: string, userId: string, tx: PrismaTransactionClient): Promise<RecalculationRunResult> {
    const pending = await tx.inventoryCostRecalculationQueue.findMany({ where: { tenantId, organizationId, status: 'PENDING' } });
    if (pending.length === 0) return { runId: null, processedKeys: 0, adjustmentsCreated: 0 };

    const earliest = pending.reduce((min, p) => (p.earliestAffectedDate < min ? p.earliestAffectedDate : min), pending[0].earliestAffectedDate);
    const run = await tx.inventoryCostCalculationRun.create({
      data: { tenantId, organizationId, calculationType: 'BACKDATED_RECALCULATION', status: 'RUNNING', initiatedBy: userId, earliestAffectedDate: earliest },
    });

    let adjustmentsCreated = 0;
    let movementCount = 0;
    for (const item of pending) {
      await tx.inventoryCostRecalculationQueue.update({ where: { id: item.id }, data: { status: 'PROCESSING', calculationRunId: run.id } });
      const outcome = await this.rebuildCostingKey(tenantId, organizationId, item.costingKey, run.id, tx);
      adjustmentsCreated += outcome.adjustmentsCreated;
      movementCount += outcome.movementCount;
      await tx.inventoryCostRecalculationQueue.update({ where: { id: item.id }, data: { status: 'COMPLETED' } });
    }

    await tx.inventoryCostCalculationRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', completedAt: new Date(), movementCount, adjustmentCount: adjustmentsCreated },
    });

    await this.audit.record(
      { tenantId, eventType: 'INVENTORY_COST_RECALCULATION_COMPLETED', entityType: 'InventoryCostCalculationRun', entityId: run.id, action: 'UPDATE', userId, newValues: { processedKeys: pending.length, adjustmentsCreated } },
      tx,
    );

    return { runId: run.id, processedKeys: pending.length, adjustmentsCreated };
  }

  private async rebuildCostingKey(
    tenantId: string,
    organizationId: string,
    costingKey: string,
    runId: string,
    tx: PrismaTransactionClient,
  ): Promise<{ adjustmentsCreated: number; movementCount: number }> {
    const movements = await tx.inventoryCostMovement.findMany({ where: { tenantId, costingKey }, orderBy: [{ effectiveDate: 'asc' }, { postingSequence: 'asc' }] });
    if (movements.length === 0) return { adjustmentsCreated: 0, movementCount: 0 };

    const staleOutgoing = new Map(
      movements
        .filter((m) => new Decimal(m.quantity.toString()).lt(0))
        .map((m) => [m.id, { unitCost: m.unitCost, totalCost: m.totalCost, sourceDocumentType: m.sourceDocumentType, sourceDocumentId: m.sourceDocumentId, sourceDocumentLineId: m.sourceDocumentLineId }]),
    );

    const layerIds = (await tx.inventoryCostLayer.findMany({ where: { tenantId, costingKey }, select: { id: true } })).map((l) => l.id);
    if (layerIds.length > 0) {
      await tx.inventoryCostComponent.deleteMany({ where: { costLayerId: { in: layerIds } } });
      await tx.inventoryCostConsumption.deleteMany({ where: { costLayerId: { in: layerIds } } });
      await tx.inventoryCostLayer.deleteMany({ where: { id: { in: layerIds } } });
    }

    let adjustmentsCreated = 0;
    for (const m of movements) {
      const policy = await this.policies.resolve(tenantId, organizationId, m.effectiveDate, tx);
      if (!policy) continue; // policy since removed — nothing sensible to replay against
      const ctx: CostEventContext = {
        tenantId,
        organizationId,
        costingKey,
        productId: m.productId,
        warehouseId: m.warehouseId,
        batchId: m.batchId,
        currencyId: m.currencyId,
        policy,
      };
      const strategy = policy.costingMethod === 'FIFO' ? this.fifo : this.averageStrategy;
      const quantity = new Decimal(m.quantity.toString());

      if (quantity.gt(0)) {
        // RECEIPT-like: unit cost is an authoritative input (the receipt's
        // own price), never recomputed — replay it as-is to rebuild layers.
        await strategy.receive(
          ctx,
          {
            quantity,
            unitCost: new Decimal(m.unitCost?.toString() ?? '0'),
            effectiveDate: m.effectiveDate,
            sourceReceiptDocumentType: m.sourceDocumentType,
            sourceReceiptDocumentId: m.sourceDocumentId,
            sourceReceiptLineId: m.sourceDocumentLineId ?? undefined,
            sourceInventoryMovementId: m.sourceInventoryMovementId,
          },
          tx,
        );
      } else if (quantity.lt(0)) {
        const outQty = quantity.abs();
        const result = await strategy.consume(
          ctx,
          {
            quantity: outQty,
            effectiveDate: m.effectiveDate,
            outgoingInventoryMovementId: m.sourceInventoryMovementId ?? undefined,
            outgoingDocumentType: m.sourceDocumentType,
            outgoingDocumentId: m.sourceDocumentId,
            outgoingDocumentLineId: m.sourceDocumentLineId ?? undefined,
            allowNegative: policy.allowNegativeQuantityCosting,
          },
          tx,
        );
        const newUnitCost = outQty.gt(0) ? result.totalCost.div(outQty) : new Decimal(0);

        await tx.inventoryCostMovement.update({
          where: { id: m.id },
          data: { unitCost: newUnitCost.toString(), totalCost: result.totalCost.negated().toString(), costStatus: result.provisional ? 'PROVISIONAL' : 'FINAL', calculationRunId: runId },
        });

        const stale = staleOutgoing.get(m.id);
        if (stale) {
          const oldAbs = new Decimal(stale.totalCost.toString()).abs();
          const newAbs = result.totalCost.abs();
          const delta = newAbs.minus(oldAbs);
          if (!delta.equals(0)) {
            await this.createRecalculationAdjustment(tenantId, organizationId, ctx, oldAbs, delta, runId, m.effectiveDate, tx);
            adjustmentsCreated += 1;
          }
        }
      }
      // quantity === 0 rows are pure value adjustments (ADDITIONAL_COST) —
      // their layer mutation already happened via applyCostDelta
      // independent of chronological replay order; nothing to redo here.
    }

    return { adjustmentsCreated, movementCount: movements.length };
  }

  private async createRecalculationAdjustment(
    tenantId: string,
    organizationId: string,
    ctx: CostEventContext,
    oldCost: Decimal,
    delta: Decimal,
    runId: string,
    documentDate: Date,
    tx: PrismaTransactionClient,
  ) {
    const adjustment = await tx.inventoryCostAdjustment.create({
      data: {
        tenantId,
        organizationId,
        // Dated at the affected movement's own effective date (never
        // "now") — a recalculation can legitimately correct a much older
        // period, and dating the correction "today" would post it into a
        // LATER numbering year than history already used, which the
        // shared NumberingService's per-year reset can't safely rewind
        // from (see docs/INVENTORY_COSTING.md's disclosed limitations).
        documentDate,
        reason: 'SYSTEM_RECALCULATION',
        calculationRunId: runId,
        status: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        comment: `Backdated recalculation run ${runId} changed the cost of a previously-recorded outgoing movement for costing key ${ctx.costingKey}`,
      },
    });
    await tx.inventoryCostAdjustmentLine.create({
      data: {
        tenantId,
        inventoryCostAdjustmentId: adjustment.id,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        costingKey: ctx.costingKey,
        oldCost: oldCost.toString(),
        adjustmentAmount: delta.toString(),
        newCost: oldCost.plus(delta).toString(),
        onHandAmount: '0',
        cogsAmount: delta.toString(),
      },
    });
    return adjustment;
  }
}
