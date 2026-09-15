import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { FIFOEngine } from './fifo-engine.service';
import { WeightedAverageEngine } from './weighted-average-engine.service';

const TOLERANCE = new Decimal('0.01');

export interface RecalculationDelta {
  costingKey: string;
  outgoingDocumentType: string;
  outgoingDocumentId: string;
  outgoingDocumentLineId: string | null;
  productId: string;
  oldCost: Decimal;
  newCost: Decimal;
  delta: Decimal; // newCost - oldCost
}

/**
 * InventoryCostRecalculationService (spec sections 46-49, 92, 109-110,
 * 127, 131). A backdated receipt or a retroactive cost change never
 * silently leaves already-posted COGS wrong (spec section 138) — this
 * service is the only path that rewrites an already-committed
 * `InventoryCostMovement`'s cost, and it always does so inside a tracked
 * `InventoryCostCalculationRun` so "what changed and why" stays
 * answerable (spec section 92: old vs new vs reason).
 *
 * Disclosed simplification vs spec section 108: no period-opening-state
 * snapshot acceleration — a run always replays the FULL movement history
 * for the affected costing key (bounded to that one key, per spec section
 * 105's own "process by costing key" guidance), not just from the
 * affected date forward. Correct, not yet optimized for very long-lived
 * costing keys.
 */
@Injectable()
export class InventoryCostRecalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly fifo: FIFOEngine,
    private readonly wac: WeightedAverageEngine,
  ) {}

  /** Called right after a new incoming layer/receipt is posted — if any
   * ISSUE movement for the same costing key was already costed with an
   * effective date AFTER this receipt's own date, that shipment's FIFO
   * ordering assumption is now stale. */
  async flagIfBackdated(
    tenantId: string,
    organizationId: string,
    costingKey: string,
    receiptEffectiveDate: Date,
    sourceDocumentType: string,
    sourceDocumentId: string,
    tx: PrismaTransactionClient,
  ) {
    const laterIssue = await tx.inventoryCostMovement.findFirst({
      where: { tenantId, costingKey, movementType: 'ISSUE', effectiveDate: { gt: receiptEffectiveDate } },
      orderBy: { effectiveDate: 'asc' },
    });
    if (!laterIssue) return;

    await this.enqueue(tx, tenantId, organizationId, costingKey, receiptEffectiveDate, 'BACKDATED_RECEIPT', sourceDocumentType, sourceDocumentId);
  }

  async requestRecalculation(tenantId: string, organizationId: string, costingKey: string, fromDate: Date, reason: string, tx: PrismaTransactionClient, sourceDocumentType?: string, sourceDocumentId?: string) {
    await this.enqueue(tx, tenantId, organizationId, costingKey, fromDate, reason, sourceDocumentType, sourceDocumentId);
  }

  private async enqueue(tx: PrismaTransactionClient, tenantId: string, organizationId: string, costingKey: string, fromDate: Date, reason: string, sourceDocumentType?: string, sourceDocumentId?: string) {
    const existing = await tx.inventoryCostRecalculationQueueEntry.findFirst({ where: { tenantId, costingKey, status: 'PENDING' } });
    if (existing) {
      if (fromDate < existing.earliestAffectedDate) {
        await tx.inventoryCostRecalculationQueueEntry.update({ where: { id: existing.id }, data: { earliestAffectedDate: fromDate } });
      }
      return existing;
    }
    return tx.inventoryCostRecalculationQueueEntry.create({
      data: { tenantId, organizationId, costingKey, earliestAffectedDate: fromDate, reason, sourceDocumentType, sourceDocumentId, status: 'PENDING' },
    });
  }

  async pendingCount(tenantId: string, organizationId?: string): Promise<number> {
    return this.prisma.inventoryCostRecalculationQueueEntry.count({ where: { tenantId, organizationId, status: 'PENDING' } });
  }

  async listPending(tenantId: string, organizationId?: string) {
    return this.prisma.inventoryCostRecalculationQueueEntry.findMany({ where: { tenantId, organizationId, status: 'PENDING' }, orderBy: { earliestAffectedDate: 'asc' } });
  }

  /** Processes every PENDING queue entry for the tenant (optionally scoped
   * to one organization) — used by `POST /inventory-costing/calculations/recalculate`
   * and by `CostingPeriodService.finalize`'s own pre-check. Returns the
   * deltas produced, for the caller to fold into an `InventoryCostAdjustment`
   * draft (spec section 116: never post GL consequences silently here). */
  async processQueue(tenantId: string, initiatedBy: string, organizationId?: string): Promise<{ runId: string; deltas: RecalculationDelta[] }[]> {
    const entries = await this.listPending(tenantId, organizationId);
    const results: { runId: string; deltas: RecalculationDelta[] }[] = [];
    for (const entry of entries) {
      const outcome = await this.prisma.runInTransaction(async (tx) => {
        await tx.inventoryCostRecalculationQueueEntry.update({ where: { id: entry.id }, data: { status: 'PROCESSING' } });
        const run = await tx.inventoryCostCalculationRun.create({
          data: { tenantId, organizationId: entry.organizationId, calculationType: 'BACKDATED_RECALCULATION', status: 'RUNNING', initiatedBy, sourceTrigger: entry.reason },
        });
        const deltas = await this.rebuildCostingKey(tenantId, entry.organizationId, entry.costingKey, run.id, tx);
        await tx.inventoryCostCalculationRun.update({
          where: { id: run.id },
          data: { status: 'COMPLETED', completedAt: new Date(), movementCount: deltas.length, adjustmentCount: deltas.filter((d) => !d.delta.abs().lt(TOLERANCE)).length },
        });
        await tx.inventoryCostRecalculationQueueEntry.update({ where: { id: entry.id }, data: { status: 'COMPLETED', processedAt: new Date(), calculationRunId: run.id } });
        return { runId: run.id, deltas };
      });
      results.push(outcome);
    }
    return results;
  }

  /** Idempotent: running twice with no intervening source change produces
   * the same layer/consumption state and an empty (or all-zero) delta set
   * the second time (spec test 131) — nothing here depends on run count. */
  async rebuildCostingKey(tenantId: string, organizationId: string, costingKey: string, calculationRunId: string, tx: PrismaTransactionClient): Promise<RecalculationDelta[]> {
    const policy = await this.policies.resolve(tenantId, organizationId, new Date(), tx);
    if (policy.costingMethod === 'WEIGHTED_AVERAGE') {
      return this.rebuildWeightedAverage(tenantId, costingKey, calculationRunId, tx);
    }
    return this.rebuildFifo(tenantId, costingKey, calculationRunId, tx);
  }

  private async rebuildFifo(tenantId: string, costingKey: string, calculationRunId: string, tx: PrismaTransactionClient): Promise<RecalculationDelta[]> {
    const layers = await tx.inventoryCostLayer.findMany({ where: { tenantId, costingKey } });
    for (const layer of layers) {
      await tx.inventoryCostConsumption.deleteMany({ where: { costLayerId: layer.id } });
      await tx.inventoryCostLayer.update({ where: { id: layer.id }, data: { remainingQuantity: layer.originalQuantity, currentUnitCost: layer.currentUnitCost, currentRemainingValue: new Decimal(layer.originalQuantity.toString()).mul(layer.currentUnitCost.toString()).toDecimalPlaces(2).toString(), status: 'OPEN' } });
    }

    const issues = await tx.inventoryCostMovement.findMany({ where: { tenantId, costingKey, movementType: 'ISSUE' }, orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] });
    const deltas: RecalculationDelta[] = [];

    for (const movement of issues) {
      const oldCost = new Decimal(movement.totalCost.toString()).abs();
      const quantity = new Decimal(movement.quantity.toString()).abs();

      const result = await this.fifo.consume(tx, {
        tenantId,
        organizationId: movement.organizationId,
        costingKey,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        quantity,
        effectiveDate: movement.effectiveDate,
        outgoingDocumentType: movement.sourceDocumentType,
        outgoingDocumentId: movement.sourceDocumentId,
        outgoingDocumentLineId: movement.sourceDocumentLineId,
        outgoingMovementId: movement.sourceMovementId,
        calculationRunId,
      });

      let newCost = result.totalConsumedCost;
      if (result.shortfallQuantity.gt(0)) {
        // Same shortfall value as originally recorded when no layer covers
        // it even after rebuild — preserves the movement's own prior
        // provisional unit cost rather than silently zeroing it.
        const priorUnitCost = new Decimal(movement.unitCost.toString()).abs();
        newCost = newCost.plus(result.shortfallQuantity.mul(priorUnitCost).toDecimalPlaces(2));
      }

      const delta = newCost.minus(oldCost);
      if (!delta.abs().lt(TOLERANCE)) {
        deltas.push({ costingKey, outgoingDocumentType: movement.sourceDocumentType, outgoingDocumentId: movement.sourceDocumentId, outgoingDocumentLineId: movement.sourceDocumentLineId, productId: movement.productId, oldCost, newCost, delta });
      }

      const newUnitCost = quantity.gt(0) ? newCost.div(quantity) : new Decimal(0);
      await tx.inventoryCostMovement.update({
        where: { id: movement.id },
        data: { unitCost: newUnitCost.toString(), totalCost: newCost.negated().toString(), costStatus: 'FINAL', calculationRunId },
      });
    }

    return deltas;
  }

  private async rebuildWeightedAverage(tenantId: string, costingKey: string, calculationRunId: string, tx: PrismaTransactionClient): Promise<RecalculationDelta[]> {
    const bucket = await tx.inventoryCostLayer.findFirst({ where: { tenantId, costingKey, sourceDocumentType: 'WAC_BUCKET' } });
    if (bucket) {
      await tx.inventoryCostConsumption.deleteMany({ where: { costLayerId: bucket.id } });
      await tx.inventoryCostComponent.deleteMany({ where: { costLayerId: bucket.id } });
      await tx.inventoryCostLayer.update({ where: { id: bucket.id }, data: { remainingQuantity: '0', originalQuantity: '0', currentUnitCost: '0', originalUnitCost: '0', currentRemainingValue: '0', originalTotalCost: '0' } });
    }

    const movements = await tx.inventoryCostMovement.findMany({ where: { tenantId, costingKey }, orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] });
    const deltas: RecalculationDelta[] = [];

    for (const movement of movements) {
      if (movement.movementType === 'RECEIPT') {
        const quantity = new Decimal(movement.quantity.toString());
        const unitCost = new Decimal(movement.unitCost.toString());
        await this.wac.receive(tx, {
          tenantId,
          organizationId: movement.organizationId,
          costingKey,
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          quantity,
          unitCost,
          receiptDate: movement.effectiveDate,
          sourceDocumentType: movement.sourceDocumentType,
          sourceDocumentId: movement.sourceDocumentId,
        });
        continue;
      }

      const oldCost = new Decimal(movement.totalCost.toString()).abs();
      const quantity = new Decimal(movement.quantity.toString()).abs();
      const result = await this.wac.consume(tx, {
        tenantId,
        organizationId: movement.organizationId,
        costingKey,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        quantity,
        effectiveDate: movement.effectiveDate,
        outgoingDocumentType: movement.sourceDocumentType,
        outgoingDocumentId: movement.sourceDocumentId,
        outgoingDocumentLineId: movement.sourceDocumentLineId,
        outgoingMovementId: movement.sourceMovementId,
        calculationRunId,
      });

      const newCost = result.totalConsumedCost;
      const delta = newCost.minus(oldCost);
      if (!delta.abs().lt(TOLERANCE)) {
        deltas.push({ costingKey, outgoingDocumentType: movement.sourceDocumentType, outgoingDocumentId: movement.sourceDocumentId, outgoingDocumentLineId: movement.sourceDocumentLineId, productId: movement.productId, oldCost, newCost, delta });
      }
      const newUnitCost = quantity.gt(0) ? newCost.div(quantity) : new Decimal(0);
      await tx.inventoryCostMovement.update({ where: { id: movement.id }, data: { unitCost: newUnitCost.toString(), totalCost: newCost.negated().toString(), costStatus: 'FINAL', calculationRunId } });
    }

    return deltas;
  }
}
