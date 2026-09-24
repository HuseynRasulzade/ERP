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
 * Posting handler for InventoryAdjustment (spec sections 17, 34, 42, 77) —
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
 * A financial consequence (Dr/Cr Inventory against Other Operating
 * Expense/Income) is posted PER LINE (never one lumped total across
 * possibly-different products — account 205 requires an exact PRODUCT
 * dimension). `costReference` (spec section 34: manual override needs its
 * own special permission/audit — enforced at the DTO/service layer, not
 * duplicated here) wins when a line carries one; otherwise WRITE_OFF asks
 * the Inventory Costing Engine for the line's actual FIFO/weighted-average
 * cost, and SURPLUS receives at the current pool cost. Either path is a
 * no-op (never a fabricated cost) when no costing policy is configured or
 * no cost can be derived. OPENING_BALANCE never posts accounting.
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

    const lines: AccountingPostingLineInput[] = [];
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

      // The cost register is always updated from the real engine (never
      // skipped just because a manual `costReference` was given) so the
      // quantity/cost-layer reconciliation health check (spec section 64)
      // never drifts. A manual `costReference` (spec section 34 — special
      // permission/audit, enforced at the DTO/service layer) can still
      // override what amount the JOURNAL itself posts for a WRITE_OFF;
      // for SURPLUS it instead sets the unit cost the engine receives at,
      // so subledger and GL always agree exactly.
      let lineTotal: Decimal | null = null;
      if (isOut) {
        const outcome = await this.costing.consumeCost(
          tenantId,
          {
            organizationId,
            productId: line.productId,
            warehouseId: adjustment.warehouseId,
            batchId: line.batchId,
            quantity: line.quantity.toString(),
            effectiveDate: businessDate,
            sourceInventoryMovementId: movement.id,
            sourceDocumentType: INVENTORY_ADJUSTMENT_TYPE,
            sourceDocumentId: adjustment.id,
            sourceDocumentLineId: line.id,
            movementType: 'WRITE_OFF',
          },
          tx,
        );
        lineTotal = line.costReference != null ? new Decimal(line.costReference.toString()) : (outcome?.totalCost ?? null);
      } else {
        const unitCost =
          line.costReference != null
            ? new Decimal(line.costReference.toString()).div(line.quantity.toString())
            : await this.costing.getUnitCost(tenantId, organizationId, line.productId, adjustment.warehouseId, businessDate, tx);
        if (unitCost && unitCost.gt(0)) {
          const outcome = await this.costing.receiveCost(
            tenantId,
            {
              organizationId,
              productId: line.productId,
              warehouseId: adjustment.warehouseId,
              batchId: line.batchId,
              quantity: line.quantity.toString(),
              unitCost: unitCost.toString(),
              effectiveDate: businessDate,
              sourceInventoryMovementId: movement.id,
              sourceDocumentType: INVENTORY_ADJUSTMENT_TYPE,
              sourceDocumentId: adjustment.id,
              sourceDocumentLineId: line.id,
              movementType: 'SURPLUS',
            },
            tx,
          );
          lineTotal = outcome?.totalCost ?? null;
        }
      }

      if (lineTotal === null || lineTotal.lte(0)) continue;

      let inventory;
      let counterAccount;
      try {
        inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
        counterAccount = await this.mappings.resolve(tenantId, organizationId, isOut ? MappingKeys.OTHER_OPERATING_EXPENSE : MappingKeys.OTHER_OPERATING_INCOME, businessDate, tx);
      } catch {
        continue;
      }

      if (isOut) {
        lines.push(
          { accountId: counterAccount.id, side: 'DEBIT', amountBase: lineTotal, sourceDocumentLineId: line.id, description: `Inventory write-off — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }, { dimensionCode: 'PRODUCT', referenceId: line.productId }] },
          { accountId: inventory.id, side: 'CREDIT', amountBase: lineTotal, sourceDocumentLineId: line.id, description: `Inventory decrease — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }] },
        );
      } else {
        lines.push(
          { accountId: inventory.id, side: 'DEBIT', amountBase: lineTotal, sourceDocumentLineId: line.id, description: `Inventory surplus — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }] },
          { accountId: counterAccount.id, side: 'CREDIT', amountBase: lineTotal, sourceDocumentLineId: line.id, description: `Inventory increase — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }, { dimensionCode: 'PRODUCT', referenceId: line.productId }] },
        );
      }
    }

    if (lines.length === 0) return null;
    return { description: `Inventory adjustment ${adjustment.number ?? adjustment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adjustment = await tx.inventoryAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (adjustment?.adjustmentType === 'WRITE_OFF') {
      await this.costing.reverseConsumption(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
    } else if (adjustment?.adjustmentType === 'SURPLUS') {
      for (const line of adjustment.lines) {
        await this.costing.removeCostForReceiptLine(tenantId, line.id, tx);
      }
      await this.costing.removeCostMovementsFor(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
    }
    await this.movements.deleteMovementsFor(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
  }
}
