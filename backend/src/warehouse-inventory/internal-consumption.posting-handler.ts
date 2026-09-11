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
 * Disclosed simplification (docs/WAREHOUSE_INVENTORY.md): the
 * `Dr Expense / Cr Inventory` accounting entry the spec describes needs a
 * per-line MONETARY cost, and this platform has no costing engine yet
 * (that is Phase 11's job — `InventoryMovement.provisionalCost` is
 * reserved for it). Rather than fabricate a cost or post a quantity-only
 * "accounting" line, this handler posts NO accounting batch at all; the
 * quantity movement (the only thing this phase can vouch for) still
 * posts unconditionally above. Once Phase 11 lands, this handler is the
 * one that should start resolving `line.expenseAccountId` (falling back
 * to `EXPENSE_MAPPING_BY_OPERATION`) against the line's costed value.
 */
@Injectable()
export class InternalConsumptionPostingHandler implements DocumentPostingHandler {
  readonly documentType = INTERNAL_CONSUMPTION_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
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

    for (const line of consumption.lines) {
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Consumption line references an unknown product');

      await this.movements.recordMovement(
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
    }

    // No costing engine yet (Phase 11) — see class doc.
    return null;
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.movements.deleteMovementsFor(tenantId, INTERNAL_CONSUMPTION_TYPE, document.id, tx);
  }
}
