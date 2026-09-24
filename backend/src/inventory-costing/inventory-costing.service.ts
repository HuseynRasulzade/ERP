import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { CostingPolicyService } from './costing-policy.service';
import { CostingPeriodService } from './costing-period.service';
import { CostingDimensionService } from './costing-dimension.service';
import { FifoCostingStrategy } from './fifo-costing.strategy';
import { WeightedAverageCostingStrategy } from './weighted-average-costing.strategy';
import { CostEventContext, InventoryCostingStrategy } from './costing-strategy.interface';
import { NoEligibleCostLayerError, ValidationAppError } from '../common/errors/app-error';

export interface ReceiveCostParams {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  quantity: Decimal.Value;
  unitCost: Decimal.Value;
  effectiveDate: Date;
  sourceInventoryMovementId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  movementType: string;
}

export interface ConsumeCostParams {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  quantity: Decimal.Value;
  effectiveDate: Date;
  sourceInventoryMovementId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  movementType: string;
  preferSourceLayerId?: string | null;
  allowNegativeOverride?: boolean;
}

export interface CostEventOutcome {
  unitCost: Decimal;
  totalCost: Decimal;
  provisional: boolean;
}

/**
 * InventoryCostingService — the single facade every document posting
 * handler calls into (spec section 87: "Monolithic calculateEverything()
 * service yaratma" — this is the thin dispatcher, FIFO/WeightedAverage do
 * the real work). Every method resolves the org's active
 * `InventoryCostingPolicy` first and is a COMPLETE NO-OP (returns `null`)
 * when none is configured — costing only activates once a tenant/org
 * explicitly adopts a policy (`POST .../inventory-costing/policy`, same
 * "adopt once per tenant" convention as Accounting Core's chart-adopt and
 * the Tax Engine's localization-seed) — see docs/INVENTORY_COSTING.md.
 * This keeps every phase 0-10 e2e test, none of which configures a
 * costing policy, completely unaffected.
 */
@Injectable()
export class InventoryCostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: CostingPolicyService,
    private readonly periods: CostingPeriodService,
    private readonly dimensions: CostingDimensionService,
    private readonly fifo: FifoCostingStrategy,
    private readonly averageStrategy: WeightedAverageCostingStrategy,
  ) {}

  private strategyFor(policy: { costingMethod: string }): InventoryCostingStrategy {
    return policy.costingMethod === 'FIFO' ? this.fifo : this.averageStrategy;
  }

  async resolveContext(
    tenantId: string,
    organizationId: string,
    productId: string,
    warehouseId: string | null | undefined,
    batchId: string | null | undefined,
    businessDate: Date,
    tx: PrismaTransactionClient,
  ): Promise<CostEventContext | null> {
    const policy = await this.policies.resolve(tenantId, organizationId, businessDate, tx);
    if (!policy) return null;
    const costingKey = this.dimensions.resolveCostingKey(policy, { organizationId, productId, warehouseId, batchId });
    return {
      tenantId,
      organizationId,
      costingKey,
      productId,
      warehouseId: policy.costByWarehouse ? warehouseId : undefined,
      batchId: policy.costByBatch ? batchId : undefined,
      currencyId: policy.valuationCurrencyId,
      policy,
    };
  }

  /** Incoming cost event (Goods Receipt, Surplus, Opening Balance, Sales
   * Return restoration) — spec sections 8, 17, 26, 34. */
  async receiveCost(tenantId: string, params: ReceiveCostParams, tx: PrismaTransactionClient): Promise<CostEventOutcome | null> {
    const ctx = await this.resolveContext(tenantId, params.organizationId, params.productId, params.warehouseId, params.batchId, params.effectiveDate, tx);
    if (!ctx) return null;

    await this.periods.assertPeriodOpen(tenantId, ctx.organizationId, params.effectiveDate, tx);

    const quantity = new Decimal(params.quantity);
    if (quantity.lte(0)) return null;
    const unitCost = new Decimal(params.unitCost);

    await this.flagIfBackdated(tenantId, ctx, params.effectiveDate, params.sourceDocumentType, params.sourceDocumentId, tx);

    const result = await this.strategyFor(ctx.policy).receive(
      ctx,
      {
        quantity,
        unitCost,
        effectiveDate: params.effectiveDate,
        sourceReceiptDocumentType: params.sourceDocumentType,
        sourceReceiptDocumentId: params.sourceDocumentId,
        sourceReceiptLineId: params.sourceDocumentLineId ?? undefined,
        sourceInventoryMovementId: params.sourceInventoryMovementId,
      },
      tx,
    );

    await this.writeCostMovement(tenantId, ctx, {
      warehouseId: params.warehouseId,
      quantity,
      unitCost: result.unitCost,
      totalCost: result.totalCost,
      effectiveDate: params.effectiveDate,
      movementType: params.movementType,
      costStatus: 'FINAL',
      sourceInventoryMovementId: params.sourceInventoryMovementId,
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentLineId: params.sourceDocumentLineId,
    }, tx);

    if (params.sourceInventoryMovementId) {
      await tx.inventoryMovement.update({ where: { id: params.sourceInventoryMovementId }, data: { costingStatus: 'FINAL' } }).catch(() => undefined);
    }

    return { unitCost: result.unitCost, totalCost: result.totalCost, provisional: false };
  }

  /** Outgoing cost event (Sales Shipment, Internal Consumption, Write-Off,
   * Purchase Return-to-supplier) — spec sections 24, 28, 34-35, 52-54.
   * Never throws for a genuinely uncostable movement — records an
   * `InventoryCostingError` and returns `null` instead, so the physical
   * (quantity) posting this always runs alongside is never blocked by a
   * costing failure (spec section 96: "Silent inconsistency olmaz" — the
   * error is recorded, not swallowed, but posting itself proceeds). */
  async consumeCost(tenantId: string, params: ConsumeCostParams, tx: PrismaTransactionClient): Promise<CostEventOutcome | null> {
    const ctx = await this.resolveContext(tenantId, params.organizationId, params.productId, params.warehouseId, params.batchId, params.effectiveDate, tx);
    if (!ctx) return null;

    await this.periods.assertPeriodOpen(tenantId, ctx.organizationId, params.effectiveDate, tx);

    const quantity = new Decimal(params.quantity);
    if (quantity.lte(0)) return null;
    const allowNegative = params.allowNegativeOverride ?? ctx.policy.allowNegativeQuantityCosting;

    await this.flagIfBackdated(tenantId, ctx, params.effectiveDate, params.sourceDocumentType, params.sourceDocumentId, tx);

    let result;
    try {
      result = await this.strategyFor(ctx.policy).consume(
        ctx,
        {
          quantity,
          effectiveDate: params.effectiveDate,
          outgoingInventoryMovementId: params.sourceInventoryMovementId,
          outgoingDocumentType: params.sourceDocumentType,
          outgoingDocumentId: params.sourceDocumentId,
          outgoingDocumentLineId: params.sourceDocumentLineId ?? undefined,
          preferSourceLayerId: params.preferSourceLayerId,
          allowNegative,
        },
        tx,
      );
    } catch (err) {
      if (err instanceof NoEligibleCostLayerError) {
        await this.recordError(tenantId, ctx, {
          errorCode: 'NO_ELIGIBLE_COST_LAYER',
          description: err.message,
          severity: 'ERROR',
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
        }, tx);
        if (params.sourceInventoryMovementId) {
          await tx.inventoryMovement.update({ where: { id: params.sourceInventoryMovementId }, data: { costingStatus: 'ERROR' } }).catch(() => undefined);
        }
        return null;
      }
      throw err;
    }

    const unitCost = quantity.gt(0) ? result.totalCost.div(quantity) : new Decimal(0);
    await this.writeCostMovement(tenantId, ctx, {
      warehouseId: params.warehouseId,
      quantity: quantity.negated(),
      unitCost,
      totalCost: result.totalCost.negated(),
      effectiveDate: params.effectiveDate,
      movementType: params.movementType,
      costStatus: result.provisional ? 'PROVISIONAL' : 'FINAL',
      sourceInventoryMovementId: params.sourceInventoryMovementId,
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentLineId: params.sourceDocumentLineId,
    }, tx);

    if (params.sourceInventoryMovementId) {
      await tx.inventoryMovement
        .update({ where: { id: params.sourceInventoryMovementId }, data: { costingStatus: result.provisional ? 'PROVISIONAL' : 'FINAL' } })
        .catch(() => undefined);
    }

    return { unitCost, totalCost: result.totalCost, provisional: result.provisional };
  }

  /** Sales Return restoration (spec sections 26-27) — restores the
   * ORIGINAL shipment's own consumed unit cost when traceable, never
   * "current average/first FIFO price" (spec's own critical rule). Falls
   * back to the current pool cost, per policy, only when no source
   * shipment line is known. */
  async restoreCostFromOriginalConsumption(
    tenantId: string,
    params: ReceiveCostParams & { originalOutgoingDocumentType?: string; originalOutgoingDocumentLineId?: string },
    tx: PrismaTransactionClient,
  ): Promise<CostEventOutcome | null> {
    const ctx = await this.resolveContext(tenantId, params.organizationId, params.productId, params.warehouseId, params.batchId, params.effectiveDate, tx);
    if (!ctx) return null;

    let unitCost: Decimal | null = null;
    if (params.originalOutgoingDocumentLineId) {
      const rows = await tx.inventoryCostConsumption.findMany({
        where: { tenantId, outgoingDocumentType: params.originalOutgoingDocumentType, outgoingDocumentLineId: params.originalOutgoingDocumentLineId, reversed: false },
      });
      if (rows.length > 0) {
        const totalQty = rows.reduce((s, r) => s.plus(r.consumedQuantity.toString()), new Decimal(0));
        const totalCost = rows.reduce((s, r) => s.plus(r.consumedCost.toString()), new Decimal(0));
        if (totalQty.gt(0)) unitCost = totalCost.div(totalQty);
      }
    }
    if (unitCost === null) {
      // Fallback (spec section 27): current pool cost — documented,
      // auditable choice, never a silently-guessed number.
      unitCost = (await this.strategyFor(ctx.policy).currentUnitCost(ctx, params.effectiveDate, tx)) ?? new Decimal(params.unitCost);
      await this.recordError(tenantId, ctx, {
        errorCode: 'SALES_RETURN_NO_SOURCE_COST',
        description: 'Sales return has no traceable original shipment consumption — restored at current pool cost instead of the original sale cost',
        severity: 'WARNING',
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
      }, tx);
    }

    return this.receiveCost(tenantId, { ...params, unitCost }, tx);
  }

  /** Warehouse transfer (spec sections 30-31) — moves value from the
   * source costing key to the destination one, total value unchanged. */
  async transferCost(
    tenantId: string,
    params: {
      organizationId: string;
      productId: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      batchId?: string | null;
      quantity: Decimal.Value;
      effectiveDate: Date;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceDocumentLineId?: string | null;
      outMovementId?: string | null;
      inMovementId?: string | null;
    },
    tx: PrismaTransactionClient,
  ): Promise<CostEventOutcome | null> {
    const outcome = await this.consumeCost(tenantId, {
      organizationId: params.organizationId,
      productId: params.productId,
      warehouseId: params.sourceWarehouseId,
      batchId: params.batchId,
      quantity: params.quantity,
      effectiveDate: params.effectiveDate,
      sourceInventoryMovementId: params.outMovementId,
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentLineId: params.sourceDocumentLineId,
      movementType: 'TRANSFER_OUT',
      allowNegativeOverride: true, // Phase 10 already validated physical availability
    }, tx);
    if (!outcome) return null;

    return this.receiveCost(tenantId, {
      organizationId: params.organizationId,
      productId: params.productId,
      warehouseId: params.destinationWarehouseId,
      batchId: params.batchId,
      quantity: params.quantity,
      unitCost: outcome.unitCost,
      effectiveDate: params.effectiveDate,
      sourceInventoryMovementId: params.inMovementId,
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentLineId: params.sourceDocumentLineId,
      movementType: 'TRANSFER_IN',
    }, tx);
  }

  /**
   * Additional/corrective cost capitalization (spec sections 18-20, 44-45).
   * FIFO with a known source layer: splits proportionally between the
   * still-on-hand remaining quantity (raises the layer's own value/unit
   * cost) and the already-consumed quantity (a COGS adjustment) — the
   * "never dump it all onto current stock when part is already sold"
   * critical rule. Weighted average (or an FIFO layer that can no longer
   * be found) capitalizes onto the pool going forward only — a disclosed
   * simplification real weighted-average systems share, since the pool
   * has no per-receipt identity left to split against.
   */
  async applyCostDelta(
    tenantId: string,
    params: {
      organizationId: string;
      productId: string;
      warehouseId?: string | null;
      batchId?: string | null;
      sourceReceiptLineId?: string | null;
      amount: Decimal.Value;
      effectiveDate: Date;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceDocumentLineId?: string | null;
      componentType?: string;
    },
    tx: PrismaTransactionClient,
  ): Promise<{ onHandAmount: Decimal; cogsAmount: Decimal; costLayerId?: string; costingKey: string } | null> {
    const ctx = await this.resolveContext(tenantId, params.organizationId, params.productId, params.warehouseId, params.batchId, params.effectiveDate, tx);
    if (!ctx) return null;
    const amount = new Decimal(params.amount);

    let layer = null as null | { id: string; originalQuantity: Decimal; remainingQuantity: Decimal; currentUnitCost: Decimal; currentRemainingValue: Decimal; status: string };
    if (ctx.policy.costingMethod === 'FIFO' && params.sourceReceiptLineId) {
      const row = await tx.inventoryCostLayer.findFirst({ where: { tenantId, costingKey: ctx.costingKey, sourceReceiptLineId: params.sourceReceiptLineId } });
      if (row) {
        layer = {
          id: row.id,
          originalQuantity: new Decimal(row.originalQuantity.toString()),
          remainingQuantity: new Decimal(row.remainingQuantity.toString()),
          currentUnitCost: new Decimal(row.currentUnitCost.toString()),
          currentRemainingValue: new Decimal(row.currentRemainingValue.toString()),
          status: row.status,
        };
      }
    }

    let onHandAmount = amount;
    let cogsAmount = new Decimal(0);

    if (layer && layer.originalQuantity.gt(0)) {
      const consumedQty = layer.originalQuantity.minus(layer.remainingQuantity);
      const perUnit = amount.div(layer.originalQuantity);
      onHandAmount = perUnit.mul(layer.remainingQuantity).toDecimalPlaces(2);
      cogsAmount = amount.minus(onHandAmount);

      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          currentUnitCost: layer.currentUnitCost.plus(perUnit).toString(),
          currentRemainingValue: layer.currentRemainingValue.plus(onHandAmount).toString(),
          status: layer.status === 'CLOSED' ? 'ADJUSTED' : layer.status,
        },
      });
      await tx.inventoryCostComponent.create({
        data: {
          tenantId,
          costLayerId: layer.id,
          componentType: params.componentType ?? 'OTHER',
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
          amount: amount.toString(),
          currencyId: ctx.currencyId,
        },
      });
      void consumedQty;
    }

    await this.writeCostMovement(tenantId, ctx, {
      warehouseId: params.warehouseId,
      quantity: new Decimal(0),
      unitCost: null,
      totalCost: amount,
      effectiveDate: params.effectiveDate,
      movementType: 'ADDITIONAL_COST',
      costStatus: 'FINAL',
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentLineId: params.sourceDocumentLineId,
    }, tx);

    return { onHandAmount, cogsAmount, costLayerId: layer?.id, costingKey: ctx.costingKey };
  }

  /** Best-effort "current unit cost" for a product/warehouse/date —
   * reporting-grade, and the real implementation behind
   * `sales-execution/CostingService.getUnitCost` (spec sections 36-38). */
  async getUnitCost(tenantId: string, organizationId: string, productId: string, warehouseId: string | null | undefined, businessDate: Date, tx?: PrismaTransactionClient): Promise<Decimal | null> {
    const client = tx ?? this.prisma;
    const ctx = await this.resolveContext(tenantId, organizationId, productId, warehouseId, null, businessDate, client);
    if (!ctx) return null;
    return this.strategyFor(ctx.policy).currentUnitCost(ctx, businessDate, client);
  }

  /** Precise per-line COGS: sums the ALREADY-COMPUTED consumption records
   * a Shipment posting wrote for this exact shipment line (spec section
   * 24 — costing happens at the physical stock-out event) — correct even
   * when several shipments of the same product/warehouse post on the same
   * day at different FIFO costs, unlike a coarse product+warehouse+date
   * lookup. `getUnitCost` above stays as the fallback/reporting path. */
  async getConsumptionCostForLine(tenantId: string, outgoingDocumentType: string, outgoingDocumentLineId: string, tx?: PrismaTransactionClient): Promise<Decimal | null> {
    const client = tx ?? this.prisma;
    const rows = await client.inventoryCostConsumption.findMany({ where: { tenantId, outgoingDocumentType, outgoingDocumentLineId, reversed: false } });
    if (rows.length === 0) return null;
    return rows.reduce((s, r) => s.plus(r.consumedCost.toString()), new Decimal(0));
  }

  async findLayerByReceiptLine(tenantId: string, sourceReceiptLineId: string, tx: PrismaTransactionClient) {
    return tx.inventoryCostLayer.findFirst({ where: { tenantId, sourceReceiptLineId } });
  }

  /**
   * Unpost guard for a Goods Receipt line (spec section 110): a FIFO layer
   * that has already been (partially) consumed by a downstream Shipment/
   * Return is never silently deleted — deleting it would orphan the
   * `InventoryCostConsumption` rows pointing at it. Weighted-average has no
   * per-receipt layer identity to protect (the pool aggregate recomputes
   * correctly however history changes), so this is a no-op there.
   */
  async removeCostForReceiptLine(tenantId: string, sourceReceiptLineId: string, tx: PrismaTransactionClient): Promise<void> {
    const layer = await tx.inventoryCostLayer.findFirst({ where: { tenantId, sourceReceiptLineId } });
    if (!layer) return;
    const original = new Decimal(layer.originalQuantity.toString());
    const remaining = new Decimal(layer.remainingQuantity.toString());
    if (remaining.lt(original)) {
      throw new ValidationAppError('Cannot unpost this goods receipt — its FIFO cost layer has already been consumed by a downstream document; unpost that document first');
    }
    await tx.inventoryCostComponent.deleteMany({ where: { tenantId, costLayerId: layer.id } });
    await tx.inventoryCostLayer.delete({ where: { id: layer.id } });
  }

  /** Removes every cost-register row this document's own posting wrote —
   * the costing-engine mirror of `InventoryMovementService.deleteMovementsFor`. */
  async removeCostMovementsFor(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    await tx.inventoryCostMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
  }

  /**
   * Symmetric undo for `consumeCost` (Shipment/Internal Consumption/
   * Write-Off/Purchase-Return unpost) — reopens whatever FIFO layers this
   * document's own consumption closed or partially closed (restoring
   * `remainingQuantity`/`currentRemainingValue`), removes the
   * `InventoryCostConsumption` rows, and removes the cost-movement rows.
   * Weighted average has no layers to reopen — deleting its cost-movement
   * row is sufficient, since the pool average recomputes from whatever
   * rows remain.
   */
  async reverseConsumption(tenantId: string, outgoingDocumentType: string, outgoingDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const consumptions = await tx.inventoryCostConsumption.findMany({ where: { tenantId, outgoingDocumentType, outgoingDocumentId, reversed: false } });
    for (const consumption of consumptions) {
      const layer = await tx.inventoryCostLayer.findFirst({ where: { id: consumption.costLayerId, tenantId } });
      if (layer) {
        const originalQuantity = new Decimal(layer.originalQuantity.toString());
        const restoredQuantity = new Decimal(layer.remainingQuantity.toString()).plus(consumption.consumedQuantity.toString());
        const restoredValue = new Decimal(layer.currentRemainingValue.toString()).plus(consumption.consumedCost.toString());
        await tx.inventoryCostLayer.update({
          where: { id: layer.id },
          data: {
            remainingQuantity: restoredQuantity.toString(),
            currentRemainingValue: restoredValue.toString(),
            status: restoredQuantity.gte(originalQuantity) ? 'OPEN' : 'PARTIALLY_CONSUMED',
          },
        });
      }
      await tx.inventoryCostConsumption.delete({ where: { id: consumption.id } });
    }
    await this.removeCostMovementsFor(tenantId, outgoingDocumentType, outgoingDocumentId, tx);
  }

  /**
   * Symmetric undo for `applyCostDelta` (AdditionalPurchaseCost unpost).
   * Reverses each `InventoryCostComponent` this document wrote off the
   * affected layer's `currentUnitCost`/`currentRemainingValue`, using the
   * layer's CURRENT remaining quantity rather than the quantity at the
   * time the cost was originally applied — a disclosed approximation when
   * further consumption happened in between (same "good enough, bounded"
   * tolerance this codebase already accepts elsewhere), then deletes the
   * component and cost-movement rows.
   */
  async reverseCostDelta(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const components = await tx.inventoryCostComponent.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
    for (const component of components) {
      const layer = await tx.inventoryCostLayer.findFirst({ where: { id: component.costLayerId, tenantId } });
      if (!layer) continue;
      const originalQuantity = new Decimal(layer.originalQuantity.toString());
      if (originalQuantity.lte(0)) continue;
      const perUnit = new Decimal(component.amount.toString()).div(originalQuantity);
      const remainingQuantity = new Decimal(layer.remainingQuantity.toString());
      const valueReversal = perUnit.mul(remainingQuantity).toDecimalPlaces(2);

      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          currentUnitCost: new Decimal(layer.currentUnitCost.toString()).minus(perUnit).toString(),
          currentRemainingValue: new Decimal(layer.currentRemainingValue.toString()).minus(valueReversal).toString(),
        },
      });
    }
    await tx.inventoryCostComponent.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
    await this.removeCostMovementsFor(tenantId, sourceDocumentType, sourceDocumentId, tx);
  }

  async recordError(
    tenantId: string,
    ctx: { organizationId: string; costingKey?: string; productId?: string },
    input: { errorCode: string; description: string; severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING'; blocking?: boolean; sourceDocumentType?: string; sourceDocumentId?: string; calculationRunId?: string },
    tx: PrismaTransactionClient,
  ) {
    return tx.inventoryCostingError.create({
      data: {
        tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        productId: ctx.productId,
        errorCode: input.errorCode,
        description: input.description,
        severity: input.severity,
        blocking: input.blocking ?? false,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        calculationRunId: input.calculationRunId,
      },
    });
  }

  /**
   * Backdated-event detection (spec sections 46-47): a movement dated
   * BEFORE the latest one already on record for this costing key means
   * everything computed after it (FIFO consumption order, or a
   * weighted-average unit cost that already baked in a now-earlier
   * receipt) may be wrong. Queues one `InventoryCostRecalculationQueue`
   * row per costing key — widening `earliestAffectedDate` to the earliest
   * of any existing pending entry rather than creating duplicates.
   */
  private async flagIfBackdated(
    tenantId: string,
    ctx: CostEventContext,
    effectiveDate: Date,
    sourceDocumentType: string,
    sourceDocumentId: string,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const later = await tx.inventoryCostMovement.findFirst({
      where: { tenantId, costingKey: ctx.costingKey, effectiveDate: { gt: effectiveDate } },
    });
    if (!later) return;

    const existingQueueEntry = await tx.inventoryCostRecalculationQueue.findFirst({
      where: { tenantId, costingKey: ctx.costingKey, status: 'PENDING' },
    });
    if (existingQueueEntry) {
      if (effectiveDate < existingQueueEntry.earliestAffectedDate) {
        await tx.inventoryCostRecalculationQueue.update({ where: { id: existingQueueEntry.id }, data: { earliestAffectedDate: effectiveDate } });
      }
      return;
    }

    await tx.inventoryCostRecalculationQueue.create({
      data: {
        tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        earliestAffectedDate: effectiveDate,
        reason: `Backdated ${sourceDocumentType} ${sourceDocumentId} posted with an effective date earlier than existing cost movements`,
        sourceDocumentType,
        sourceDocumentId,
      },
    });
  }

  private async writeCostMovement(
    tenantId: string,
    ctx: CostEventContext,
    input: {
      warehouseId?: string | null;
      quantity: Decimal;
      unitCost: Decimal | null;
      totalCost: Decimal;
      effectiveDate: Date;
      movementType: string;
      costStatus: string;
      sourceInventoryMovementId?: string | null;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceDocumentLineId?: string | null;
    },
    tx: PrismaTransactionClient,
  ) {
    return tx.inventoryCostMovement.create({
      data: {
        tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: ctx.productId,
        batchId: ctx.batchId ?? undefined,
        sourceInventoryMovementId: input.sourceInventoryMovementId ?? undefined,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        movementType: input.movementType,
        quantity: input.quantity.toString(),
        unitCost: input.unitCost ? input.unitCost.toString() : undefined,
        totalCost: input.totalCost.toString(),
        costStatus: input.costStatus,
        currencyId: ctx.currencyId ?? undefined,
      },
    });
  }
}
