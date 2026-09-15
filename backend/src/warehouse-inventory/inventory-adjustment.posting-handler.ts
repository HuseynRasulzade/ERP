import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_ADJUSTMENT_TYPE } from './inventory-adjustment.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

/**
 * Posting handler for InventoryAdjustment (spec sections 17, 42, 77;
 * Phase 11 spec sections 34-35, 55; Phase 12 spec sections 52-56) —
 * write-off, surplus, and opening balance consolidated into one document
 * type via `adjustmentType` (disclosed simplification of the spec's three
 * separate concepts, see docs/WAREHOUSE_INVENTORY.md):
 *   WRITE_OFF        — quantity leaves the register (OUT), stock decreases
 *   SURPLUS          — quantity enters the register (IN), stock increases
 *   OPENING_BALANCE  — quantity enters the register (IN); this establishes
 *                       the Phase 10 quantity register's starting point
 *                       only — it never touches Accounting Core's own
 *                       opening balance concept (Phase 4,
 *                       ACCOUNTING_OPENING_BALANCE_MANAGE), which is a
 *                       separate axis entirely.
 *
 * WRITE_OFF/SURPLUS lines are costed by the real Phase 11 engine — actual
 * FIFO/weighted-average consumption for a write-off, the configured
 * negative-stock/surplus fallback ladder for a surplus (spec section 35) —
 * never a fabricated amount. A line's own `costReference` is honored ONLY
 * as an explicit manual override (`INVENTORY_COST_MANUAL_OVERRIDE`
 * permission is expected at the controller/DTO layer for that path);
 * omitting it lets Phase 11 price the line automatically. OPENING_BALANCE
 * never posts accounting regardless.
 */
@Injectable()
export class InventoryAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
    private readonly mappings: AccountingMappingService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adjustment = await tx.inventoryAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, warehouse: true } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    if (adjustment.lines.length === 0) throw new ValidationAppError('Cannot post an inventory adjustment with no lines');

    for (const line of adjustment.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post an adjustment line with non-positive quantity');
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Adjustment line references an unknown product');

      if (adjustment.adjustmentType === 'WRITE_OFF') {
        await this.movements.lockStockKey(tx, tenantId, adjustment.warehouseId, line.productId, line.batchId);
        await this.availability.validateAvailability(
          tenantId,
          adjustment.warehouseId,
          adjustment.warehouse.code,
          line.productId,
          product.code,
          new Decimal(line.quantity.toString()),
          adjustment.warehouse.allowNegativeStock,
          { batchId: line.batchId ?? undefined },
          tx,
        );
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adjustment = await tx.inventoryAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adjustment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const isOut = adjustment.adjustmentType === 'WRITE_OFF';

    const lineCosts: { productId: string; amount: Decimal }[] = [];

    for (const line of adjustment.lines) {
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Adjustment line references an unknown product');

      const movement = await this.movements.recordMovement(
        tenantId,
        {
          organizationId,
          warehouseId: adjustment.warehouseId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: line.stockStatus ?? 'AVAILABLE',
          movementType: adjustment.adjustmentType,
          quantity: isOut ? new Decimal(line.quantity.toString()).negated() : new Decimal(line.quantity.toString()),
          effectiveDate: businessDate,
          registrarDocumentType: INVENTORY_ADJUSTMENT_TYPE,
          registrarDocumentId: adjustment.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );

      if (adjustment.adjustmentType === 'OPENING_BALANCE') continue;

      // The Phase 11 subledger is always kept in sync with this movement
      // (spec section 34: costing must never just skip a line) — an
      // explicit `costReference` overrides only the GL POSTING amount
      // below, a documented, audited divergence from the engine's own
      // computed value for the rare manual-override case.
      let engineAmount: Decimal;
      if (isOut) {
        const result = await this.costing.calculateOutgoingCost(
          tenantId,
          { organizationId, productId: line.productId, warehouseId: adjustment.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), effectiveDate: businessDate, outgoingDocumentType: INVENTORY_ADJUSTMENT_TYPE, outgoingDocumentId: adjustment.id, outgoingDocumentLineId: line.id, outgoingMovementId: movement.id },
          tx,
        );
        engineAmount = result.totalCost;
      } else {
        const unitCost = await this.costing.resolveCurrentUnitCost(tenantId, organizationId, line.productId, adjustment.warehouseId, line.batchId, businessDate, tx);
        await this.costing.processIncomingMovement(
          tenantId,
          { organizationId, productId: line.productId, warehouseId: adjustment.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), unitCost: unitCost.toString(), effectiveDate: businessDate, sourceDocumentType: INVENTORY_ADJUSTMENT_TYPE, sourceDocumentId: adjustment.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id },
          tx,
        );
        engineAmount = unitCost.mul(line.quantity.toString()).toDecimalPlaces(2);
      }

      lineCosts.push({ productId: line.productId, amount: line.costReference != null ? new Decimal(line.costReference.toString()) : engineAmount });
    }

    if (adjustment.adjustmentType === 'OPENING_BALANCE') return null;

    const total = lineCosts.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    if (total.lte(0)) return null;

    let inventory;
    let counterAccount;
    try {
      inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
      counterAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        isOut ? MappingKeys.OTHER_OPERATING_EXPENSE : MappingKeys.OTHER_OPERATING_INCOME,
        businessDate,
        tx,
      );
    } catch {
      return null;
    }

    // One inventory line per product (each carries its own PRODUCT
    // dimension) plus one lump counter-entry — same shape as
    // AdditionalPurchaseCostPostingHandler's own per-product allocation.
    const lines: AccountingPostingLineInput[] = lineCosts.map((l) => ({
      accountId: inventory.id,
      side: isOut ? 'CREDIT' : 'DEBIT',
      amountBase: l.amount,
      description: isOut ? `Inventory decrease — ${adjustment.number ?? adjustment.id}` : `Inventory increase — ${adjustment.number ?? adjustment.id}`,
      dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }, { dimensionCode: 'PRODUCT', referenceId: l.productId }],
    }));
    lines.push({
      accountId: counterAccount.id,
      side: isOut ? 'DEBIT' : 'CREDIT',
      amountBase: total,
      description: isOut ? `Inventory write-off — ${adjustment.number ?? adjustment.id}` : `Inventory surplus — ${adjustment.number ?? adjustment.id}`,
      dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }],
    });

    return { description: `Inventory adjustment ${adjustment.number ?? adjustment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    if (await this.costing.hasDownstreamConsumption(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx)) {
      throw new ValidationAppError('this adjustment\'s cost layer has already been consumed by a later inventory movement — unpost that movement first');
    }
    await this.costing.reverseOutgoing(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
    await this.costing.reverseIncoming(tenantId, document.organizationId!, INVENTORY_ADJUSTMENT_TYPE, document.id, document.postingDate ?? document.documentDate, tx);
    await this.movements.deleteMovementsFor(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
  }
}
