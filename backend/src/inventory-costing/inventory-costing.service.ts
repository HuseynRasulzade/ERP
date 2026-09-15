import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { CostingDimensionService } from './costing-dimension.service';
import { FIFOEngine } from './fifo-engine.service';
import { WeightedAverageEngine } from './weighted-average-engine.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { CostingPeriodService } from './costing-period.service';

export interface ReceiveMovementInput {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  currencyId?: string | null;
  quantity: Decimal.Value;
  unitCost: Decimal.Value | null; // null => no known price yet (spec section 17's "zero / pending cost")
  effectiveDate: Date;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  sourceMovementId?: string | null;
}

export interface IssueMovementInput {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  quantity: Decimal.Value;
  effectiveDate: Date;
  outgoingDocumentType: string;
  outgoingDocumentId: string;
  outgoingDocumentLineId?: string | null;
  outgoingMovementId: string;
}

/**
 * InventoryCostingService — the orchestrating facade posting handlers call
 * (spec section 87's "no monolithic calculateEverything()" is honored by
 * keeping FIFO/WeightedAverage/layer/recalculation logic in their own
 * services; this class only resolves policy+dimension and delegates).
 * Exposes the internal API surface spec section 115 asks for
 * (`calculateIssueCost`/`getUnitCost`/`getCOGS` live here;
 * `getInventoryValue`/`getCostLayerTrace` on InventoryValuationService,
 * `requestRecalculation`/`validateCostingHealth` on their own services).
 */
@Injectable()
export class InventoryCostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly dimensions: CostingDimensionService,
    private readonly fifo: FIFOEngine,
    private readonly wac: WeightedAverageEngine,
    private readonly recalculation: InventoryCostRecalculationService,
    private readonly periods: CostingPeriodService,
  ) {}

  /** Prices an incoming (RECEIPT) InventoryMovement — called from
   * GoodsReceiptPostingHandler/PurchaseReturnPostingHandler/
   * SalesReturnPostingHandler right after Phase 10's own movement is
   * written. Never throws on a missing price (spec section 17): a
   * `null` unitCost posts a zero-cost, PROVISIONAL InventoryCostMovement
   * and an UNCALCULATED-cost error, rather than blocking the physical
   * receipt (Phase 10 quantity truth is never gated on Phase 11 pricing). */
  async processIncomingMovement(tenantId: string, input: ReceiveMovementInput, tx: PrismaTransactionClient) {
    await this.periods.assertPeriodOpenForCosting(tenantId, input.organizationId, input.effectiveDate, tx);
    const policy = await this.policies.resolve(tenantId, input.organizationId, input.effectiveDate, tx);
    const costingKey = this.dimensions.resolveKey(policy, input);
    const quantity = new Decimal(input.quantity);
    const known = input.unitCost != null;
    const unitCost = known ? new Decimal(input.unitCost!) : new Decimal(0);

    if (policy.costingMethod === 'WEIGHTED_AVERAGE') {
      await this.wac.receive(tx, {
        tenantId,
        organizationId: input.organizationId,
        costingKey,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        currencyId: input.currencyId,
        quantity,
        unitCost,
        receiptDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        sourceMovementId: input.sourceMovementId,
      });
    } else {
      await this.fifo.createLayer(tx, {
        tenantId,
        organizationId: input.organizationId,
        costingKey,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        currencyId: input.currencyId,
        quantity,
        unitCost,
        receiptDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        sourceMovementId: input.sourceMovementId,
      });
    }

    const totalCost = quantity.mul(unitCost).toDecimalPlaces(2);
    await tx.inventoryCostMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: input.productId,
        batchId: input.batchId ?? undefined,
        sourceMovementId: input.sourceMovementId ?? input.sourceDocumentId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.effectiveDate,
        movementType: 'RECEIPT',
        quantity: quantity.toString(),
        unitCost: unitCost.toString(),
        totalCost: totalCost.toString(),
        provisional: !known,
        valuationCurrencyId: policy.valuationCurrencyId ?? input.currencyId ?? undefined,
        costStatus: known ? 'FINAL' : 'UNCALCULATED',
      },
    });

    // Phase 10's own reserved handoff columns (see WarehouseInventoryModule
    // docstring / docs/WAREHOUSE_INVENTORY.md) — a denormalized projection
    // only, never read back as authoritative by this service itself.
    if (input.sourceMovementId) {
      await tx.inventoryMovement.updateMany({ where: { id: input.sourceMovementId, tenantId }, data: { provisionalCost: unitCost.toString(), costingStatus: known ? 'FINAL' : 'UNCALCULATED' } });
    }

    if (!known) {
      await tx.inventoryCostingError.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          productId: input.productId,
          costingKey,
          documentType: input.sourceDocumentType,
          documentId: input.sourceDocumentId,
          errorCode: 'MISSING_SOURCE_PRICE',
          description: `Receipt ${input.sourceDocumentType} ${input.sourceDocumentId} posted with no known unit cost — costing is PROVISIONAL pending a purchase invoice/price correction.`,
          severity: 'WARNING',
        },
      });
    }

    // Backdated-receipt detection (spec section 46): if a shipment dated
    // AFTER this receipt was already costed before this receipt existed,
    // FIFO order has changed underneath it — queue a recalculation from
    // this receipt's own date rather than leave that shipment's COGS wrong.
    await this.recalculation.flagIfBackdated(tenantId, input.organizationId, costingKey, input.effectiveDate, input.sourceDocumentType, input.sourceDocumentId, tx);

    return { costingKey };
  }

  /** Prices an outgoing (ISSUE) InventoryMovement — called from
   * ShipmentPostingHandler/PurchaseReturnPostingHandler(issue leg)/
   * InternalConsumption/WriteOff handlers. Consumes FIFO layers or the
   * weighted-average bucket per policy; any shortfall is priced under the
   * configured `negativeStockCostPolicy` (spec sections 52-54) rather than
   * left uncosted. */
  async calculateOutgoingCost(tenantId: string, input: IssueMovementInput, tx: PrismaTransactionClient) {
    await this.periods.assertPeriodOpenForCosting(tenantId, input.organizationId, input.effectiveDate, tx);
    const policy = await this.policies.resolve(tenantId, input.organizationId, input.effectiveDate, tx);
    const costingKey = this.dimensions.resolveKey(policy, input);
    const quantity = new Decimal(input.quantity);
    const engine = policy.costingMethod === 'WEIGHTED_AVERAGE' ? this.wac : this.fifo;

    const result = await engine.consume(tx, {
      tenantId,
      organizationId: input.organizationId,
      costingKey,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchId: input.batchId,
      quantity,
      effectiveDate: input.effectiveDate,
      outgoingDocumentType: input.outgoingDocumentType,
      outgoingDocumentId: input.outgoingDocumentId,
      outgoingDocumentLineId: input.outgoingDocumentLineId,
      outgoingMovementId: input.outgoingMovementId,
    });

    let totalCost = result.totalConsumedCost;
    let provisional = false;

    if (result.shortfallQuantity.gt(0)) {
      if (!policy.allowNegativeQuantityCosting || policy.negativeStockCostPolicy === 'BLOCK_COSTING') {
        await tx.inventoryCostingError.create({
          data: {
            tenantId,
            organizationId: input.organizationId,
            productId: input.productId,
            costingKey,
            documentType: input.outgoingDocumentType,
            documentId: input.outgoingDocumentId,
            errorCode: 'NO_ELIGIBLE_FIFO_LAYER',
            description: `${result.shortfallQuantity.toString()} units of ${input.productId} could not be costed — no eligible cost layer/bucket and negative-stock costing is blocked.`,
            severity: 'BLOCKING',
            blocking: true,
          },
        });
      } else {
        const provisionalUnitCost = await this.resolveNegativeStockUnitCost(tenantId, costingKey, policy.negativeStockCostPolicy, tx);
        const shortfallCost = result.shortfallQuantity.mul(provisionalUnitCost).toDecimalPlaces(2);
        totalCost = totalCost.plus(shortfallCost);
        provisional = true;
        await tx.inventoryCostingError.create({
          data: {
            tenantId,
            organizationId: input.organizationId,
            productId: input.productId,
            costingKey,
            documentType: input.outgoingDocumentType,
            documentId: input.outgoingDocumentId,
            errorCode: 'NEGATIVE_INVENTORY_INCONSISTENCY',
            description: `${result.shortfallQuantity.toString()} units costed provisionally at ${provisionalUnitCost.toString()} under ${policy.negativeStockCostPolicy} — no cost layer covered this quantity.`,
            severity: 'WARNING',
          },
        });
      }
    }

    const unitCostAvg = quantity.gt(0) ? totalCost.div(quantity) : new Decimal(0);
    await tx.inventoryCostMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: input.productId,
        batchId: input.batchId ?? undefined,
        sourceMovementId: input.outgoingMovementId,
        sourceDocumentType: input.outgoingDocumentType,
        sourceDocumentId: input.outgoingDocumentId,
        sourceDocumentLineId: input.outgoingDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.effectiveDate,
        movementType: 'ISSUE',
        quantity: quantity.negated().toString(),
        unitCost: unitCostAvg.toString(),
        totalCost: totalCost.negated().toString(),
        provisional,
        costStatus: provisional ? 'PROVISIONAL' : 'FINAL',
      },
    });

    await tx.inventoryMovement.updateMany({ where: { id: input.outgoingMovementId, tenantId }, data: { provisionalCost: unitCostAvg.toString(), costingStatus: provisional ? 'PROVISIONAL' : 'FINAL' } });

    return { costingKey, totalCost, unitCost: unitCostAvg, breakdown: result.breakdown };
  }

  /** Surplus valuation (spec section 35) reuses the exact same fallback
   * ladder negative-stock costing uses (spec section 54's options overlap
   * almost entirely with section 35's) — resolves a costing key's current
   * cost for the given dimensions without requiring a real incoming
   * document. Public: called by InventoryAdjustmentPostingHandler (write-
   * off/surplus) and by Phase 12's InventoryCountCostingService. */
  async resolveCurrentUnitCost(tenantId: string, organizationId: string, productId: string, warehouseId: string | null | undefined, batchId: string | null | undefined, effectiveDate: Date, tx: PrismaTransactionClient, fallbackPolicy?: string): Promise<Decimal> {
    const policy = await this.policies.resolve(tenantId, organizationId, effectiveDate, tx);
    const costingKey = this.dimensions.resolveKey(policy, { organizationId, productId, warehouseId, batchId });
    return this.resolveNegativeStockUnitCost(tenantId, costingKey, fallbackPolicy ?? policy.negativeStockCostPolicy, tx);
  }

  private async resolveNegativeStockUnitCost(tenantId: string, costingKey: string, negativeStockCostPolicy: string, tx: PrismaTransactionClient): Promise<Decimal> {
    if (negativeStockCostPolicy === 'ZERO_PENDING') return new Decimal(0);

    // LAST_KNOWN_COST / CURRENT_AVERAGE / STANDARD_COST all fall back to
    // the last movement's unit cost in this build — a real STANDARD_COST
    // table is out of Phase 11's scope (spec section 3's own extension
    // point), so it degrades to the same "last known" value rather than
    // fabricating a standard that was never configured.
    const lastMovement = await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey, costStatus: { not: 'ERROR' } }, orderBy: { createdAt: 'desc' } });
    if (lastMovement) return new Decimal(lastMovement.unitCost.toString()).abs();
    return new Decimal(0);
  }

  /** Reverses whatever this outgoing movement consumed (unpost). */
  async reverseOutgoing(tenantId: string, outgoingDocumentType: string, outgoingDocumentId: string, tx: PrismaTransactionClient) {
    await this.fifo.reverseConsumption(tx, tenantId, outgoingDocumentType, outgoingDocumentId);
    await this.wac.reverseConsumption(tx, tenantId, outgoingDocumentType, outgoingDocumentId);
    await tx.inventoryCostMovement.deleteMany({ where: { tenantId, sourceDocumentType: outgoingDocumentType, sourceDocumentId: outgoingDocumentId, movementType: 'ISSUE' } });
  }

  /** Reverses a receipt (unpost) — caller must have already confirmed
   * (via `fifo.hasConsumption`) that nothing downstream drew from it. */
  async reverseIncoming(tenantId: string, organizationId: string, sourceDocumentType: string, sourceDocumentId: string, effectiveDate: Date, tx: PrismaTransactionClient) {
    const movements = await tx.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'RECEIPT' } });
    for (const m of movements) {
      const policy = await this.policies.resolve(tenantId, organizationId, effectiveDate, tx);
      if (policy.costingMethod === 'WEIGHTED_AVERAGE') {
        await this.wac.reverseReceipt(tx, tenantId, m.costingKey, new Decimal(m.quantity.toString()), new Decimal(m.unitCost.toString()), sourceDocumentType, sourceDocumentId);
      }
    }
    await this.fifo.reverseLayer(tx, tenantId, sourceDocumentType, sourceDocumentId);
    await tx.inventoryCostMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, movementType: 'RECEIPT' } });
    await tx.inventoryCostingError.deleteMany({ where: { tenantId, documentType: sourceDocumentType, documentId: sourceDocumentId, resolved: false } });
  }

  /** Whether a receipt has already been (partially) consumed downstream —
   * a posting handler's own `undoSideEffects` must block unposting when
   * this is true (spec section 110's "dependency block") rather than
   * silently deleting a layer something else already drew from. */
  async hasDownstreamConsumption(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<boolean> {
    return this.fifo.hasConsumption(tx, tenantId, sourceDocumentType, sourceDocumentId);
  }

  /**
   * Warehouse transfer cost preservation (spec sections 30-32): consumes
   * the source costing key at its current cost and opens a new layer (or
   * folds into the WAC bucket) at the destination using that SAME unit
   * cost — organization-wide inventory value never moves, only which
   * costing key holds it. A no-op when the policy doesn't cost by
   * warehouse (spec section 30's own "if cost_by_warehouse=false, the two
   * warehouses already share one costing key" case — nothing to transfer).
   */
  async transferCost(
    tenantId: string,
    input: {
      organizationId: string;
      productId: string;
      batchId?: string | null;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      quantity: Decimal.Value;
      effectiveDate: Date;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceLineId?: string | null;
      sourceOutMovementId: string;
      destInMovementId: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const policy = await this.policies.resolve(tenantId, input.organizationId, input.effectiveDate, tx);
    if (!policy.costByWarehouse) return; // same costingKey on both sides — nothing moves

    const out = await this.calculateOutgoingCost(
      tenantId,
      {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.sourceWarehouseId,
        batchId: input.batchId,
        quantity: input.quantity,
        effectiveDate: input.effectiveDate,
        outgoingDocumentType: input.sourceDocumentType,
        outgoingDocumentId: input.sourceDocumentId,
        outgoingDocumentLineId: input.sourceLineId,
        outgoingMovementId: input.sourceOutMovementId,
      },
      tx,
    );

    await this.processIncomingMovement(
      tenantId,
      {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.destinationWarehouseId,
        batchId: input.batchId,
        quantity: input.quantity,
        unitCost: out.unitCost,
        effectiveDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceLineId,
        sourceMovementId: input.destInMovementId,
      },
      tx,
    );
  }

  /**
   * Sales return cost restoration (spec sections 26-27): when the return
   * is linked to an original shipment line, the returned quantity is
   * re-opened as a new layer at that shipment's REALIZED cost (from
   * `InventoryCostConsumption`), never at today's current/average cost.
   * Falls back to the current policy's negative-stock unit cost (flagged
   * as a costing error for manual review, per spec section 27) when no
   * source shipment line is known or it was never priced.
   */
  async receiveReturnMovement(
    tenantId: string,
    input: {
      organizationId: string;
      productId: string;
      warehouseId?: string | null;
      batchId?: string | null;
      quantity: Decimal.Value;
      effectiveDate: Date;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceDocumentLineId?: string | null;
      sourceMovementId?: string | null;
      originalShipmentLineId?: string | null;
    },
    tx: PrismaTransactionClient,
  ) {
    let unitCost: Decimal | null = null;

    if (input.originalShipmentLineId) {
      const original = await tx.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentType: 'SHIPMENT', sourceDocumentLineId: input.originalShipmentLineId, movementType: 'ISSUE' } });
      if (original) unitCost = new Decimal(original.unitCost.toString()).abs();
    }

    if (unitCost == null) {
      const policy = await this.policies.resolve(tenantId, input.organizationId, input.effectiveDate, tx);
      const costingKey = this.dimensions.resolveKey(policy, input);
      unitCost = await this.resolveNegativeStockUnitCost(tenantId, costingKey, policy.negativeStockCostPolicy, tx);
      await tx.inventoryCostingError.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          productId: input.productId,
          costingKey,
          documentType: input.sourceDocumentType,
          documentId: input.sourceDocumentId,
          errorCode: 'BROKEN_SOURCE_LINK',
          description: `Sales return ${input.sourceDocumentId} has no traceable original shipment cost — restored at fallback cost ${unitCost.toString()} (${policy.negativeStockCostPolicy}). Review manually.`,
          severity: 'WARNING',
        },
      });
    }

    return this.processIncomingMovement(
      tenantId,
      {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        quantity: input.quantity,
        unitCost,
        effectiveDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        sourceMovementId: input.sourceMovementId,
      },
      tx,
    );
  }

  /**
   * Purchase return issue cost (spec section 28): when the return is
   * linked to a specific original receipt line, consumes SPECIFICALLY
   * that line's FIFO layer rather than whatever FIFO's normal
   * oldest-first order would pick — the spec's own worked example (return
   * from Receipt B, not Receipt A, even though A is older).
   */
  async calculateOutgoingCostFromSpecificReceipt(
    tenantId: string,
    input: {
      organizationId: string;
      productId: string;
      warehouseId?: string | null;
      quantity: Decimal.Value;
      effectiveDate: Date;
      outgoingDocumentType: string;
      outgoingDocumentId: string;
      outgoingDocumentLineId?: string | null;
      outgoingMovementId: string;
      sourceReceiptLineId: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const layer = await tx.inventoryCostLayer.findFirst({ where: { tenantId, sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentLineId: input.sourceReceiptLineId } });
    if (!layer) {
      // No FIFO layer for that receipt line (e.g. WEIGHTED_AVERAGE policy,
      // or the receipt was never priced) — fall back to the normal engine.
      return this.calculateOutgoingCost(tenantId, input, tx);
    }

    const quantity = new Decimal(input.quantity);
    const result = await this.fifo.consumeSpecificLayer(tx, layer.id, quantity, {
      tenantId,
      organizationId: input.organizationId,
      costingKey: layer.costingKey,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity,
      effectiveDate: input.effectiveDate,
      outgoingDocumentType: input.outgoingDocumentType,
      outgoingDocumentId: input.outgoingDocumentId,
      outgoingDocumentLineId: input.outgoingDocumentLineId,
      outgoingMovementId: input.outgoingMovementId,
    });

    const unitCostAvg = quantity.gt(0) ? result.totalConsumedCost.div(quantity) : new Decimal(0);
    await tx.inventoryCostMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        costingKey: layer.costingKey,
        warehouseId: input.warehouseId ?? undefined,
        productId: input.productId,
        sourceMovementId: input.outgoingMovementId,
        sourceDocumentType: input.outgoingDocumentType,
        sourceDocumentId: input.outgoingDocumentId,
        sourceDocumentLineId: input.outgoingDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.effectiveDate,
        movementType: 'ISSUE',
        quantity: quantity.negated().toString(),
        unitCost: unitCostAvg.toString(),
        totalCost: result.totalConsumedCost.negated().toString(),
        costStatus: 'FINAL',
      },
    });

    return { costingKey: layer.costingKey, totalCost: result.totalConsumedCost, unitCost: unitCostAvg, breakdown: result.breakdown };
  }

  /** getUnitCost (spec section 115) — the average unit cost actually
   * realized for a specific outgoing document line, read back from the
   * consumption this engine already recorded (never re-derived from
   * today's layers/average, which could have moved on since). Backs
   * `CostingService.getUnitCost` for Sales Invoice COGS posting. */
  async getRealizedUnitCost(tenantId: string, outgoingDocumentType: string, outgoingDocumentLineId: string): Promise<Decimal | null> {
    const movement = await this.prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentType: outgoingDocumentType, sourceDocumentLineId: outgoingDocumentLineId, movementType: 'ISSUE' } });
    if (!movement) return null;
    return new Decimal(movement.unitCost.toString()).abs();
  }

  async getCOGSForLine(tenantId: string, outgoingDocumentType: string, outgoingDocumentLineId: string): Promise<Decimal | null> {
    const movement = await this.prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentType: outgoingDocumentType, sourceDocumentLineId: outgoingDocumentLineId, movementType: 'ISSUE' } });
    if (!movement) return null;
    return new Decimal(movement.totalCost.toString()).abs();
  }
}
