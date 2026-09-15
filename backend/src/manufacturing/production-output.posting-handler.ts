import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { InventoryMovementService } from '../warehouse-inventory/inventory-movement.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { PRODUCTION_OUTPUT_RECEIPT_TYPE } from './production-output.repository';

const OUTPUT_TRANSFER_COMPONENT = 'OUTPUT_TRANSFER';

/**
 * Posting handler for ProductionOutputReceipt (spec sections 63-70).
 * Provisional unit cost (spec sections 68-69) is the order's own
 * accumulated WIP balance (Σ `ProductionCostMovement.costIn -
 * costOut`) at the moment of receipt, split across the order's own
 * outputs by planned quantity — every `costAllocationMethod` value
 * other than `BY_QUANTITY` degrades to the same by-quantity split in
 * this build (disclosed simplification, see docs/MANUFACTURING.md).
 * The receipt both creates the real Phase 10 inventory IN and a Phase 11
 * cost layer (`InventoryCostingService.processIncomingMovement`) at that
 * provisional cost, and reduces WIP by the same amount — later final
 * costing (this build's own `ProductionCloseService`) adjusts the
 * layer/COGS via Phase 11's own recalculation architecture, never by
 * silently rewriting this receipt.
 */
@Injectable()
export class ProductionOutputPostingHandler implements DocumentPostingHandler {
  readonly documentType = PRODUCTION_OUTPUT_RECEIPT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly costing: InventoryCostingService,
    private readonly mappings: AccountingMappingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const receipt = await tx.productionOutputReceipt.findFirst({ where: { id: document.id, tenantId }, include: { output: true } });
    if (!receipt) throw new ValidationAppError('Document disappeared during posting');
    if (receipt.goodQuantity.lte(0)) throw new ValidationAppError('Cannot post a receipt with non-positive quantity');
    const alreadyReceived = new Decimal(receipt.output.receivedQuantity.toString());
    if (alreadyReceived.plus(receipt.goodQuantity.toString()).gt(new Decimal(receipt.output.plannedQuantity.toString()).plus('0.001'))) {
      // Over-receipt against plan is allowed but flagged — production reality can exceed the plan (spec section 67); not blocked.
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const receipt = await tx.productionOutputReceipt.findFirst({ where: { id: document.id, tenantId }, include: { output: true, order: { include: { outputs: true } } } });
    if (!receipt) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = receipt.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    // Provisional unit cost (spec sections 68-69): the order's CURRENT WIP
    // balance spread evenly per remaining planned unit across ALL of its
    // outputs — algebraically equivalent to a BY_QUANTITY co-product
    // split applied continuously as receipts come in, without needing to
    // reconstruct each output's own historical share (every
    // `costAllocationMethod` other than BY_QUANTITY degrades to this same
    // rule in this build, disclosed simplification, see
    // docs/MANUFACTURING.md).
    const wipAgg = await tx.productionCostMovement.aggregate({ where: { tenantId, productionOrderId: receipt.productionOrderId, reversed: false }, _sum: { costIn: true, costOut: true } });
    const wipBalance = Decimal.max(new Decimal((wipAgg._sum.costIn ?? 0).toString()).minus((wipAgg._sum.costOut ?? 0).toString()), 0);
    const remainingPlannedTotal = receipt.order.outputs.reduce((s, o) => s.plus(Decimal.max(new Decimal(o.plannedQuantity.toString()).minus(o.receivedQuantity.toString()), 0)), new Decimal(0));
    const unitCost = remainingPlannedTotal.gt(0) ? wipBalance.dividedBy(remainingPlannedTotal) : new Decimal(0);
    const receiptCost = unitCost.mul(receipt.goodQuantity.toString()).toDecimalPlaces(2);
    const cappedReceiptCost = Decimal.min(receiptCost, wipBalance);

    const movement = await this.movements.recordMovement(tenantId, { organizationId, warehouseId: receipt.warehouseId, productId: receipt.output.productId, unitId: receipt.output.unitId, batchId: receipt.batchId, stockStatus: 'AVAILABLE', movementType: receipt.outputKind === 'SEMI_FINISHED' ? 'PRODUCTION_SEMI_FINISHED_RECEIPT' : 'PRODUCTION_OUTPUT_RECEIPT', quantity: new Decimal(receipt.goodQuantity.toString()), effectiveDate: businessDate, registrarDocumentType: PRODUCTION_OUTPUT_RECEIPT_TYPE, registrarDocumentId: receipt.id, createdBy: document.postedBy ?? document.createdBy ?? undefined }, tx);

    await this.costing.processIncomingMovement(tenantId, { organizationId, productId: receipt.output.productId, warehouseId: receipt.warehouseId, batchId: receipt.batchId, quantity: receipt.goodQuantity.toString(), unitCost: cappedReceiptCost.gt(0) ? cappedReceiptCost.dividedBy(receipt.goodQuantity.toString()) : new Decimal(0), effectiveDate: businessDate, sourceDocumentType: PRODUCTION_OUTPUT_RECEIPT_TYPE, sourceDocumentId: receipt.id, sourceMovementId: movement.id }, tx);

    await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: receipt.productionOrderId, outputReceiptId: receipt.id, costComponent: OUTPUT_TRANSFER_COMPONENT, costOut: cappedReceiptCost.toString(), quantityOut: receipt.goodQuantity.toString(), sourceDocumentType: PRODUCTION_OUTPUT_RECEIPT_TYPE, sourceDocumentId: receipt.id, effectiveDate: businessDate } });
    await tx.productionOrderOutput.update({ where: { id: receipt.outputId }, data: { receivedQuantity: { increment: receipt.goodQuantity.toString() } } });
    await tx.productionOutputReceipt.update({ where: { id: receipt.id }, data: { provisionalUnitCost: receipt.goodQuantity.gt(0) ? cappedReceiptCost.dividedBy(receipt.goodQuantity.toString()).toString() : '0' } });

    if (cappedReceiptCost.lte(0)) return null;
    const finishedGoodsAccount = await this.mappings.resolve(tenantId, organizationId, receipt.outputKind === 'SEMI_FINISHED' ? MappingKeys.MATERIAL_INVENTORY : MappingKeys.FINISHED_GOODS, businessDate, tx).catch(() => null);
    const wipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.WORK_IN_PROGRESS, businessDate, tx).catch(() => null);
    if (!finishedGoodsAccount || !wipAccount) return null;
    const dims = [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: receipt.productionOrderId }, { dimensionCode: 'PRODUCT', referenceId: receipt.output.productId }];

    return { description: `Production output receipt ${receipt.number ?? receipt.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: finishedGoodsAccount.id, side: 'DEBIT', amountBase: cappedReceiptCost, description: 'Finished/semi-finished goods received', dimensions: dims }, { accountId: wipAccount.id, side: 'CREDIT', amountBase: cappedReceiptCost, description: 'WIP transferred to output', dimensions: dims }] };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const receipt = await tx.productionOutputReceipt.findFirst({ where: { id: document.id, tenantId } });
    if (!receipt) return;
    await this.costing.reverseIncoming(tenantId, receipt.organizationId, PRODUCTION_OUTPUT_RECEIPT_TYPE, document.id, document.postingDate ?? document.documentDate, tx);
    await this.movements.deleteMovementsFor(tenantId, PRODUCTION_OUTPUT_RECEIPT_TYPE, document.id, tx);
    await tx.productionCostMovement.updateMany({ where: { tenantId, sourceDocumentType: PRODUCTION_OUTPUT_RECEIPT_TYPE, sourceDocumentId: document.id }, data: { reversed: true } });
    await tx.productionOrderOutput.update({ where: { id: receipt.outputId }, data: { receivedQuantity: { decrement: receipt.goodQuantity.toString() } } });
  }
}
