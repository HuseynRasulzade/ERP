import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { INTERNAL_CONSUMPTION_TYPE } from './internal-consumption.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

const EXPENSE_MAPPING_BY_OPERATION: Record<string, string> = {
  OFFICE_CONSUMPTION: MappingKeys.ADMIN_EXPENSE,
  MARKETING: MappingKeys.COMMERCIAL_EXPENSE,
  MAINTENANCE: MappingKeys.OTHER_OPERATING_EXPENSE,
  PROJECT_USE: MappingKeys.OTHER_OPERATING_EXPENSE,
  OTHER: MappingKeys.OTHER_OPERATING_EXPENSE,
};

/**
 * Posting handler for InternalConsumption (spec section 16) — non-sale
 * stock use (office/marketing/maintenance/project). Writes a real OUT
 * inventory movement always.
 *
 * The `Dr Expense / Cr Inventory` accounting entry the spec describes needs
 * a per-line MONETARY cost — now supplied by the Inventory Costing Engine
 * (Phase 11) via `InventoryCostingService.consumeCost`. When the
 * organization has no costing policy configured (or the engine could not
 * cost a specific line — see `consumeCost`'s docstring), this handler still
 * posts NO accounting batch for that line, exactly as before — never a
 * fabricated cost. `line.expenseAccountId` wins when set, falling back to
 * `EXPENSE_MAPPING_BY_OPERATION` keyed by the document's `operationType`.
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

    const lines: AccountingPostingLineInput[] = [];
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

      const outcome = await this.costing.consumeCost(
        tenantId,
        {
          organizationId,
          productId: line.productId,
          warehouseId: consumption.warehouseId,
          batchId: line.batchId,
          quantity: line.quantity.toString(),
          effectiveDate: businessDate,
          sourceInventoryMovementId: movement.id,
          sourceDocumentType: INTERNAL_CONSUMPTION_TYPE,
          sourceDocumentId: consumption.id,
          sourceDocumentLineId: line.id,
          movementType: 'INTERNAL_CONSUMPTION',
        },
        tx,
      );
      if (!outcome) continue; // no costing policy configured / uncostable — never fabricate a value

      const expenseAccount = line.expenseAccountId
        ? await tx.account.findFirst({ where: { id: line.expenseAccountId, tenantId } })
        : await this.mappings.resolve(tenantId, organizationId, EXPENSE_MAPPING_BY_OPERATION[consumption.operationType] ?? MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx);
      if (!expenseAccount) continue;
      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);

      lines.push(
        {
          accountId: expenseAccount.id,
          side: 'DEBIT',
          amountBase: outcome.totalCost,
          sourceDocumentLineId: line.id,
          description: `Internal consumption — ${consumption.number ?? consumption.id}`,
          dimensions: consumption.departmentId ? [{ dimensionCode: 'DEPARTMENT', referenceId: consumption.departmentId }] : [],
        },
        {
          accountId: inventory.id,
          side: 'CREDIT',
          amountBase: outcome.totalCost,
          sourceDocumentLineId: line.id,
          description: `Inventory decrease — ${consumption.number ?? consumption.id}`,
          dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }, { dimensionCode: 'WAREHOUSE', referenceId: consumption.warehouseId }],
        },
      );
    }

    if (lines.length === 0) return null;
    return { description: `Internal consumption ${consumption.number ?? consumption.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.costing.reverseConsumption(tenantId, INTERNAL_CONSUMPTION_TYPE, document.id, tx);
    await this.movements.deleteMovementsFor(tenantId, INTERNAL_CONSUMPTION_TYPE, document.id, tx);
  }
}
