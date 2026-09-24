import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { InventoryCostingDimensionService } from './costing-dimension.service';
import { FIFOCostingStrategy } from './fifo-costing.strategy';
import { WeightedAverageCostingStrategy } from './weighted-average-costing.strategy';
import { InventoryCostingStrategy } from './inventory-costing.types';
import { ValidationAppError } from '../common/errors/app-error';

export interface CostMovementInput {
  tenantId: string;
  organizationId: string;
  inventoryMovementId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  effectiveDate: Date;
  postingDate: Date;
}

/**
 * InventoryCostCalculationService — the one orchestrator called from
 * posting handlers (spec section 87: "Monolithic calculateEverything()
 * service yaratma" — this stays a thin dispatcher; FIFO/WA engines hold
 * the actual logic). Resolves the organization's policy, resolves the
 * costingKey, picks the strategy (spec section 88 — Strategy pattern),
 * and writes the InventoryCostMovement register row.
 *
 * Idempotent (spec sections 93, 130): `sourceInventoryMovementId` is
 * unique on InventoryCostMovement, so reprocessing the same inventory
 * movement returns the existing row instead of costing it twice.
 */
@Injectable()
export class InventoryCostCalculationService {
  constructor(
    private readonly policies: InventoryCostingPolicyService,
    private readonly dimensions: InventoryCostingDimensionService,
    private readonly fifo: FIFOCostingStrategy,
    private readonly weightedAverage: WeightedAverageCostingStrategy,
  ) {}

  private strategyFor(costingMethod: string): InventoryCostingStrategy {
    return costingMethod === 'FIFO' ? this.fifo : this.weightedAverage;
  }

  /** Cost a RECEIPT-type inventory movement (spec section 17) — unitCost
   * comes from the caller (Goods Receipt line price today; Purchase
   * Invoice price differences are a follow-up, not this core build). */
  async costReceiptMovement(input: CostMovementInput & { quantity: Decimal.Value; unitCost: Decimal.Value }, tx: PrismaTransactionClient) {
    const existing = await tx.inventoryCostMovement.findUnique({ where: { sourceInventoryMovementId: input.inventoryMovementId } });
    if (existing) return existing;

    const policy = await this.policies.resolve(input.tenantId, input.organizationId, input.effectiveDate, tx);
    const costingKey = this.dimensions.resolveCostingKey(policy, input);
    const quantity = new Decimal(input.quantity);
    const unitCost = new Decimal(input.unitCost);

    await this.strategyFor(policy.costingMethod).processIncomingMovement(
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        costingKey,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        inventoryMovementId: input.inventoryMovementId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        effectiveDate: input.effectiveDate,
        postingDate: input.postingDate,
        quantity,
        unitCost,
        currencyId: policy.valuationCurrencyId,
      },
      tx,
    );

    return tx.inventoryCostMovement.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: input.productId,
        batchId: input.batchId ?? undefined,
        sourceInventoryMovementId: input.inventoryMovementId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.postingDate,
        movementType: 'RECEIPT',
        quantity: quantity.toString(),
        unitCost: unitCost.toString(),
        totalCost: quantity.mul(unitCost).toString(),
        finalCost: quantity.mul(unitCost).toString(),
        valuationCurrencyId: policy.valuationCurrencyId,
        costStatus: 'FINAL',
      },
    });
  }

  /** Cost an ISSUE-type inventory movement (Sales Shipment, Purchase
   * Return, etc.) — computes cost via the resolved strategy and returns
   * the unit cost for the caller to use in COGS posting. Returns `null`
   * when no cost data exists yet, preserving the pre-engine "skip the
   * COGS entry, never fabricate" contract that CostingService.getUnitCost
   * established. */
  async costIssueMovement(input: CostMovementInput & { quantity: Decimal.Value }, tx: PrismaTransactionClient): Promise<Decimal | null> {
    const existing = await tx.inventoryCostMovement.findUnique({ where: { sourceInventoryMovementId: input.inventoryMovementId } });
    if (existing) return new Decimal(existing.unitCost.toString());

    const policy = await this.policies.resolve(input.tenantId, input.organizationId, input.effectiveDate, tx);
    const costingKey = this.dimensions.resolveCostingKey(policy, input);
    const quantity = new Decimal(input.quantity);

    const result = await this.strategyFor(policy.costingMethod).calculateOutgoingCost(
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        costingKey,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        inventoryMovementId: input.inventoryMovementId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        effectiveDate: input.effectiveDate,
        postingDate: input.postingDate,
        quantity,
        currencyId: policy.valuationCurrencyId,
      },
      tx,
    );
    if (!result) return null;

    await tx.inventoryCostMovement.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: input.productId,
        batchId: input.batchId ?? undefined,
        sourceInventoryMovementId: input.inventoryMovementId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.postingDate,
        movementType: 'ISSUE',
        quantity: quantity.toString(),
        unitCost: result.unitCost.toString(),
        totalCost: result.totalCost.toString(),
        provisionalCost: result.costStatus === 'PROVISIONAL' ? result.totalCost.toString() : undefined,
        finalCost: result.costStatus === 'FINAL' ? result.totalCost.toString() : undefined,
        valuationCurrencyId: policy.valuationCurrencyId,
        costStatus: result.costStatus,
      },
    });

    return result.unitCost;
  }

  /** Symmetric undo for a receipt's cost effects (spec section 110 —
   * default to the safer "dependency block" variant rather than
   * cascading recalculation). Blocks if any of the receipt's FIFO layers
   * have already been consumed by a downstream issue; otherwise removes
   * the layer(s) it created (FIFO) or reverses its contribution to the
   * running balance (Weighted Average). */
  async removeCostForReceipt(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const layers = await tx.inventoryCostLayer.findMany({ where: { tenantId, sourceReceiptDocumentType: sourceDocumentType, sourceReceiptDocumentId: sourceDocumentId } });
    for (const layer of layers) {
      if (new Decimal(layer.remainingQuantity.toString()).lt(new Decimal(layer.originalQuantity.toString()))) {
        throw new ValidationAppError('Cannot unpost: this receipt\'s cost layer has already been consumed by a downstream shipment — unpost that document first');
      }
    }
    const movements = await tx.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'RECEIPT' } });

    if (layers.length > 0) {
      await tx.inventoryCostConsumption.deleteMany({ where: { costLayerId: { in: layers.map((l) => l.id) } } });
      await tx.inventoryCostLayer.deleteMany({ where: { id: { in: layers.map((l) => l.id) } } });
    } else {
      // Weighted Average — reverse this receipt's contribution to the running balance.
      // Simplification: assumes no later movement has already consumed part of it;
      // full backdated-safe reversal is a follow-up (recalculation engine, not in this core build).
      for (const m of movements) {
        const balance = await tx.inventoryCostBalance.findUnique({ where: { tenantId_costingKey: { tenantId, costingKey: m.costingKey } } });
        if (!balance) continue;
        const qty = new Decimal(m.quantity.toString());
        const value = new Decimal(m.totalCost.toString());
        const newQty = new Decimal(balance.quantity.toString()).minus(qty);
        const newValue = new Decimal(balance.totalValue.toString()).minus(value);
        await tx.inventoryCostBalance.update({
          where: { tenantId_costingKey: { tenantId, costingKey: m.costingKey } },
          data: { quantity: newQty.toString(), totalValue: newValue.toString(), averageUnitCost: newQty.gt(0) ? newValue.div(newQty).toString() : '0' },
        });
      }
    }
    await tx.inventoryCostMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'RECEIPT' } });
  }

  /** Symmetric undo for an issue's cost effects — restores consumed FIFO
   * layer quantities and deletes the InventoryCostConsumption/CostMovement
   * rows it created, or restores the Weighted Average balance. */
  async removeCostForIssue(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const consumptions = await tx.inventoryCostConsumption.findMany({ where: { tenantId, outgoingDocumentType: sourceDocumentType, outgoingDocumentId: sourceDocumentId } });
    for (const c of consumptions) {
      const layer = await tx.inventoryCostLayer.findUnique({ where: { id: c.costLayerId } });
      if (!layer) continue;
      const restoredQty = new Decimal(layer.remainingQuantity.toString()).plus(c.consumedQuantity.toString());
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          remainingQuantity: restoredQty.toString(),
          currentRemainingValue: restoredQty.mul(layer.currentUnitCost.toString()).toString(),
          status: restoredQty.gte(layer.originalQuantity.toString()) ? 'OPEN' : 'PARTIALLY_CONSUMED',
        },
      });
    }
    await tx.inventoryCostConsumption.deleteMany({ where: { tenantId, outgoingDocumentType: sourceDocumentType, outgoingDocumentId: sourceDocumentId } });

    const movements = await tx.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'ISSUE' } });
    for (const m of movements) {
      const balance = await tx.inventoryCostBalance.findUnique({ where: { tenantId_costingKey: { tenantId, costingKey: m.costingKey } } });
      if (!balance) continue;
      const qty = new Decimal(m.quantity.toString());
      const value = new Decimal(m.totalCost.toString());
      const newQty = new Decimal(balance.quantity.toString()).plus(qty);
      const newValue = new Decimal(balance.totalValue.toString()).plus(value);
      await tx.inventoryCostBalance.update({
        where: { tenantId_costingKey: { tenantId, costingKey: m.costingKey } },
        data: { quantity: newQty.toString(), totalValue: newValue.toString(), averageUnitCost: newQty.gt(0) ? newValue.div(newQty).toString() : '0' },
      });
    }
    await tx.inventoryCostMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'ISSUE' } });
  }
}
