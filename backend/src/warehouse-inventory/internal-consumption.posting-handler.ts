import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { INTERNAL_CONSUMPTION_TYPE } from './internal-consumption.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

const EXPENSE_MAPPING_BY_OPERATION: Record<string, string> = {
  OFFICE_CONSUMPTION: MappingKeys.ADMIN_EXPENSE,
  MARKETING: MappingKeys.COMMERCIAL_EXPENSE,
  MAINTENANCE: MappingKeys.OTHER_OPERATING_EXPENSE,
  PROJECT_USE: MappingKeys.OTHER_OPERATING_EXPENSE,
  OTHER: MappingKeys.OTHER_OPERATING_EXPENSE,
};

/**
 * Posting handler for InternalConsumption (spec section 16; Phase 11 spec
 * section 35) — non-sale stock use (office/marketing/maintenance/project).
 * Writes a real OUT inventory movement always, and now a real
 * `Dr Expense / Cr Inventory` entry at the actual Phase 11 FIFO/weighted-
 * average cost (`EXPENSE_MAPPING_BY_OPERATION` resolves the expense
 * account by `operationType`, falling back to `line.expenseAccountId`
 * when set) — no longer skipped for lack of a costing engine.
 */
@Injectable()
export class InternalConsumptionPostingHandler implements DocumentPostingHandler {
  readonly documentType = INTERNAL_CONSUMPTION_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
    private readonly mappings: AccountingMappingService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const consumption = await tx.internalConsumption.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, warehouse: true } });
    if (!consumption) throw new ValidationAppError('Document disappeared during posting');
    if (consumption.lines.length === 0) throw new ValidationAppError('Cannot post an internal consumption with no lines');

    for (const line of consumption.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a consumption line with non-positive quantity');
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Consumption line references an unknown product');

      await this.movements.lockStockKey(tx, tenantId, consumption.warehouseId, line.productId, line.batchId);
      await this.availability.validateAvailability(
        tenantId,
        consumption.warehouseId,
        consumption.warehouse.code,
        line.productId,
        product.code,
        new Decimal(line.quantity.toString()),
        consumption.warehouse.allowNegativeStock,
        { batchId: line.batchId ?? undefined },
        tx,
      );
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const consumption = await tx.internalConsumption.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!consumption) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = consumption.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    const expenseMappingKey = EXPENSE_MAPPING_BY_OPERATION[consumption.operationType] ?? MappingKeys.OTHER_OPERATING_EXPENSE;
    const expenseAccount = await this.mappings.resolve(tenantId, organizationId, expenseMappingKey, businessDate, tx).catch(() => null);
    const inventoryAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx).catch(() => null);

    const lines: AccountingPostingLineInput[] = [];
    let total = new Decimal(0);

    for (const line of consumption.lines) {
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Consumption line references an unknown product');

      const movement = await this.movements.recordMovement(
        tenantId,
        {
          organizationId,
          warehouseId: consumption.warehouseId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: 'AVAILABLE',
          movementType: 'INTERNAL_CONSUMPTION',
          quantity: new Decimal(line.quantity.toString()).negated(),
          effectiveDate: businessDate,
          registrarDocumentType: INTERNAL_CONSUMPTION_TYPE,
          registrarDocumentId: consumption.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );

      const result = await this.costing.calculateOutgoingCost(
        tenantId,
        { organizationId, productId: line.productId, warehouseId: consumption.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), effectiveDate: businessDate, outgoingDocumentType: INTERNAL_CONSUMPTION_TYPE, outgoingDocumentId: consumption.id, outgoingDocumentLineId: line.id, outgoingMovementId: movement.id },
        tx,
      );
      if (result.totalCost.lte(0) || !expenseAccount || !inventoryAccount) continue;

      total = total.plus(result.totalCost);
      lines.push({
        accountId: line.expenseAccountId ?? expenseAccount.id,
        side: 'DEBIT',
        amountBase: result.totalCost,
        sourceDocumentLineId: line.id,
        description: `Internal consumption — ${consumption.number ?? consumption.id}`,
        dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }, ...(consumption.departmentId ? [{ dimensionCode: 'DEPARTMENT', referenceId: consumption.departmentId }] : [])],
      });
      lines.push({ accountId: inventoryAccount.id, side: 'CREDIT', amountBase: result.totalCost, sourceDocumentLineId: line.id, description: `Inventory decrease — ${consumption.number ?? consumption.id}`, dimensions: [{ dimensionCode: 'WAREHOUSE', referenceId: consumption.warehouseId }] });
    }

    if (lines.length === 0 || total.lte(0)) return null;
    return { description: `Internal consumption ${consumption.number ?? consumption.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.costing.reverseOutgoing(tenantId, INTERNAL_CONSUMPTION_TYPE, document.id, tx);
    await this.movements.deleteMovementsFor(tenantId, INTERNAL_CONSUMPTION_TYPE, document.id, tx);
  }
}
