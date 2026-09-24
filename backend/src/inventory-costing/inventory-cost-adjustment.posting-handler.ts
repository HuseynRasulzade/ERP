import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COST_ADJUSTMENT_TYPE } from './inventory-cost-adjustment.repository';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

/**
 * Posting handler for InventoryCostAdjustment (spec sections 44-45, 61) —
 * a pure GL-correction step. The subledger side (FIFO layer/weighted
 * average pool mutation) already happened at CREATE time — either via
 * `InventoryCostingService.applyCostDelta` (a manual adjustment, same
 * moment `AdditionalPurchaseCostPostingHandler` touches a layer) or during
 * a backdated recalculation rebuild (`InventoryCostRecalculationService`) —
 * so posting never re-touches a cost layer, only turns the already-computed
 * `onHandAmount`/`cogsAmount` split per line into balanced Dr/Cr entries:
 *   cogsAmount > 0:  Dr COGS / Cr Inventory        (more expense recognized)
 *   cogsAmount < 0:  Dr Inventory / Cr COGS         (less expense — reversal)
 *   onHandAmount > 0: Dr Inventory / Cr Other Operating Income
 *   onHandAmount < 0: Dr Other Operating Expense / Cr Inventory
 * The Other-Operating counter-account is a disclosed simplification for a
 * value-only correction with no fresh supplier bill/AP consequence — the
 * same convention `InventoryAdjustmentPostingHandler`'s WRITE_OFF/SURPLUS
 * already uses.
 */
@Injectable()
export class InventoryCostAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_COST_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adjustment = await tx.inventoryCostAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    if (adjustment.lines.length === 0) throw new ValidationAppError('Cannot post an inventory cost adjustment with no lines');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adjustment = await tx.inventoryCostAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adjustment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const cogs = await this.mappings.resolve(tenantId, organizationId, MappingKeys.COGS, businessDate, tx);

    const lines: AccountingPostingLineInput[] = [];
    for (const line of adjustment.lines) {
      const cogsAmount = new Decimal(line.cogsAmount.toString());
      const onHandAmount = new Decimal(line.onHandAmount.toString());
      const dims = [{ dimensionCode: 'PRODUCT', referenceId: line.productId }, ...(line.warehouseId ? [{ dimensionCode: 'WAREHOUSE', referenceId: line.warehouseId }] : [])];

      if (!cogsAmount.equals(0)) {
        const abs = cogsAmount.abs();
        if (cogsAmount.gt(0)) {
          lines.push(
            { accountId: cogs.id, side: 'DEBIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Cost adjustment (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
            { accountId: inventory.id, side: 'CREDIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Cost adjustment (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
          );
        } else {
          lines.push(
            { accountId: inventory.id, side: 'DEBIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Cost adjustment reversal (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
            { accountId: cogs.id, side: 'CREDIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Cost adjustment reversal (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
          );
        }
      }

      if (!onHandAmount.equals(0)) {
        const abs = onHandAmount.abs();
        const counter = await this.mappings.resolve(tenantId, organizationId, onHandAmount.gt(0) ? MappingKeys.OTHER_OPERATING_INCOME : MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx);
        if (onHandAmount.gt(0)) {
          lines.push(
            { accountId: inventory.id, side: 'DEBIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Inventory value increase (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
            { accountId: counter.id, side: 'CREDIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Inventory value increase (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
          );
        } else {
          lines.push(
            { accountId: counter.id, side: 'DEBIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Inventory value decrease (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
            { accountId: inventory.id, side: 'CREDIT', amountBase: abs, sourceDocumentLineId: line.id, description: `Inventory value decrease (${adjustment.reason}) — ${adjustment.number ?? adjustment.id}`, dimensions: dims },
          );
        }
      }
    }

    if (lines.length === 0) return null;
    return { description: `Inventory cost adjustment ${adjustment.number ?? adjustment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }
}
