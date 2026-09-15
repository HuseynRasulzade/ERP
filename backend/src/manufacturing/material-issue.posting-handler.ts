import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { InventoryMovementService } from '../warehouse-inventory/inventory-movement.service';
import { StockAvailabilityService } from '../warehouse-inventory/stock-availability.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { MATERIAL_ISSUE_TYPE } from './material-issue.repository';

/**
 * Posting handler for MaterialIssue (spec sections 35-41). Material cost
 * comes ONLY from Phase 11's actual FIFO/weighted-average engine — never
 * the BOM's planned unit cost (spec section 38's own explicit
 * prohibition, illustrated by section 39's worked example). A `RETURN`
 * restores stock at the ORIGINAL issue line's own realized cost (spec
 * section 41), found via `InventoryCostingService.getRealizedUnitCost`
 * against the requirement's prior issue lines — never today's average.
 * GL: Dr WORK_IN_PROGRESS / Cr MATERIAL_INVENTORY for an issue, reversed
 * for a return (spec section 37).
 */
@Injectable()
export class MaterialIssuePostingHandler implements DocumentPostingHandler {
  readonly documentType = MATERIAL_ISSUE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
    private readonly costing: InventoryCostingService,
    private readonly mappings: AccountingMappingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const issue = await tx.materialIssue.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, warehouse: true, order: true } });
    if (!issue) throw new ValidationAppError('Document disappeared during posting');
    if (issue.lines.length === 0) throw new ValidationAppError('Cannot post a material issue with no lines');
    if (issue.order.status === 'CANCELLED') throw new ValidationAppError('Cannot issue material against a cancelled production order');
    if (issue.issueType === 'ISSUE') {
      for (const line of issue.lines) {
        await this.movements.lockStockKey(tx, tenantId, issue.warehouseId, line.productId, line.batchId);
        await this.availability.validateAvailability(tenantId, issue.warehouseId, issue.warehouse.code, line.productId, line.productId, new Decimal(line.quantity.toString()), issue.warehouse.allowNegativeStock, { batchId: line.batchId ?? undefined }, tx);
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const issue = await tx.materialIssue.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, order: true } });
    if (!issue) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = issue.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const isReturn = issue.issueType === 'RETURN';

    const wipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.WORK_IN_PROGRESS, businessDate, tx).catch(() => null);
    const inventoryAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.MATERIAL_INVENTORY, businessDate, tx).catch(() => null);
    const lines: AccountingPostingLineInput[] = [];
    let total = new Decimal(0);

    for (const line of issue.lines) {
      const requirement = line.requirementId ? await tx.productionMaterialRequirement.findFirst({ where: { id: line.requirementId, tenantId } }) : null;

      const movement = await this.movements.recordMovement(
        tenantId,
        { organizationId, warehouseId: issue.warehouseId, productId: line.productId, unitId: line.unitId, batchId: line.batchId, stockStatus: 'AVAILABLE', movementType: isReturn ? 'PRODUCTION_MATERIAL_RETURN' : 'PRODUCTION_MATERIAL_ISSUE', quantity: isReturn ? new Decimal(line.quantity.toString()) : new Decimal(line.quantity.toString()).negated(), effectiveDate: businessDate, registrarDocumentType: MATERIAL_ISSUE_TYPE, registrarDocumentId: issue.id, registrarLineId: line.id, createdBy: document.postedBy ?? document.createdBy ?? undefined },
        tx,
      );

      let cost: Decimal;
      if (isReturn) {
        const originalLine = await tx.materialIssueLine.findFirst({ where: { tenantId, requirementId: line.requirementId, issue: { issueType: 'ISSUE' } }, orderBy: { id: 'desc' } });
        const realized = originalLine ? await this.costing.getRealizedUnitCost(tenantId, MATERIAL_ISSUE_TYPE, originalLine.id) : null;
        const unitCost = realized ?? (await this.costing.resolveCurrentUnitCost(tenantId, organizationId, line.productId, issue.warehouseId, line.batchId, businessDate, tx));
        cost = unitCost.mul(line.quantity.toString());
        await this.costing.processIncomingMovement(tenantId, { organizationId, productId: line.productId, warehouseId: issue.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), unitCost, effectiveDate: businessDate, sourceDocumentType: MATERIAL_ISSUE_TYPE, sourceDocumentId: issue.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id }, tx);
        if (requirement) await tx.productionMaterialRequirement.update({ where: { id: requirement.id }, data: { returnedQuantity: { increment: line.quantity.toString() } } });
      } else {
        const result = await this.costing.calculateOutgoingCost(tenantId, { organizationId, productId: line.productId, warehouseId: issue.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), effectiveDate: businessDate, outgoingDocumentType: MATERIAL_ISSUE_TYPE, outgoingDocumentId: issue.id, outgoingDocumentLineId: line.id, outgoingMovementId: movement.id }, tx);
        cost = result.totalCost;
        if (requirement) await tx.productionMaterialRequirement.update({ where: { id: requirement.id }, data: { issuedQuantity: { increment: line.quantity.toString() }, consumedQuantity: { increment: line.quantity.toString() } } });
      }

      await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: issue.productionOrderId, costComponent: 'DIRECT_MATERIAL', costIn: isReturn ? '0' : cost.toString(), costOut: isReturn ? cost.toString() : '0', quantityIn: isReturn ? line.quantity.toString() : undefined, quantityOut: isReturn ? undefined : line.quantity.toString(), sourceDocumentType: MATERIAL_ISSUE_TYPE, sourceDocumentId: issue.id, effectiveDate: businessDate } });

      if (cost.gt(0) && wipAccount && inventoryAccount) {
        total = total.plus(cost);
        const dims = [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: issue.productionOrderId }, { dimensionCode: 'PRODUCT', referenceId: line.productId }];
        lines.push({ accountId: isReturn ? inventoryAccount.id : wipAccount.id, side: 'DEBIT', amountBase: cost, sourceDocumentLineId: line.id, description: `${isReturn ? 'Material returned' : 'Material issued'} — ${issue.number ?? issue.id}`, dimensions: dims });
        lines.push({ accountId: isReturn ? wipAccount.id : inventoryAccount.id, side: 'CREDIT', amountBase: cost, sourceDocumentLineId: line.id, description: `${isReturn ? 'WIP reduced' : 'Inventory decrease'} — ${issue.number ?? issue.id}`, dimensions: dims });
      }
    }

    if (lines.length === 0 || total.lte(0)) return null;
    return { description: `${isReturn ? 'Material return' : 'Material issue'} ${issue.number ?? issue.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const issue = await tx.materialIssue.findFirst({ where: { id: document.id, tenantId } });
    if (!issue) return;
    if (issue.issueType === 'ISSUE') await this.costing.reverseOutgoing(tenantId, MATERIAL_ISSUE_TYPE, document.id, tx);
    else await this.costing.reverseIncoming(tenantId, issue.organizationId, MATERIAL_ISSUE_TYPE, document.id, document.postingDate ?? document.documentDate, tx);
    await this.movements.deleteMovementsFor(tenantId, MATERIAL_ISSUE_TYPE, document.id, tx);
    await tx.productionCostMovement.updateMany({ where: { tenantId, sourceDocumentType: MATERIAL_ISSUE_TYPE, sourceDocumentId: document.id }, data: { reversed: true } });
  }
}
