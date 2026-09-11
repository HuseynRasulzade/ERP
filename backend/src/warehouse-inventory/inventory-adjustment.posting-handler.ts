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

/**
 * Posting handler for InventoryAdjustment (spec sections 17, 42, 77) —
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
 * Expense/Income) is posted ONLY when every line carries an explicit
 * `costReference` — with no costing engine yet (Phase 11), there is
 * nothing else to derive a monetary amount from, and this handler never
 * fabricates one (same convention as InternalConsumptionPostingHandler).
 * OPENING_BALANCE never posts accounting regardless of `costReference`.
 */
@Injectable()
export class InventoryAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
    private readonly mappings: AccountingMappingService,
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

    for (const line of adjustment.lines) {
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Adjustment line references an unknown product');

      await this.movements.recordMovement(
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
    }

    if (adjustment.adjustmentType === 'OPENING_BALANCE') return null;
    if (adjustment.lines.some((l) => l.costReference == null)) return null;

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

    const total = adjustment.lines.reduce((s, l) => s.plus(new Decimal(l.costReference!.toString())), new Decimal(0));
    if (total.lte(0)) return null;

    const lines: AccountingPostingLineInput[] = isOut
      ? [
          { accountId: counterAccount.id, side: 'DEBIT', amountBase: total, description: `Inventory write-off — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }, { dimensionCode: 'PRODUCT', referenceId: adjustment.lines[0].productId }] },
          { accountId: inventory.id, side: 'CREDIT', amountBase: total, description: `Inventory decrease — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }] },
        ]
      : [
          { accountId: inventory.id, side: 'DEBIT', amountBase: total, description: `Inventory surplus — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }] },
          { accountId: counterAccount.id, side: 'CREDIT', amountBase: total, description: `Inventory increase — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: adjustment.warehouseId }, { dimensionCode: 'PRODUCT', referenceId: adjustment.lines[0].productId }] },
        ];

    return { description: `Inventory adjustment ${adjustment.number ?? adjustment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.movements.deleteMovementsFor(tenantId, INVENTORY_ADJUSTMENT_TYPE, document.id, tx);
  }
}
