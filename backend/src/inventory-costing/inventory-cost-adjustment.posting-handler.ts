import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { INVENTORY_COST_ADJUSTMENT_TYPE } from './inventory-cost-adjustment.repository';
import { FIFOEngine } from './fifo-engine.service';

/**
 * Posting handler for InventoryCostAdjustment (spec sections 44-45, 61).
 * Two shapes, chosen per line:
 *   `costLayerId` set  — a FIFO layer correction (late invoice, landed
 *   cost, migration): the amount is split between on-hand inventory and
 *   already-recognized COGS exactly like `AdditionalCostCapitalizationService`
 *   (same proportional rule, spec section 45).
 *   `costLayerId` unset — a direct COGS/inventory correction (e.g. a
 *   weighted-average period revaluation delta, or a manual override with
 *   no single layer to attribute it to): the signed `adjustmentAmount`
 *   posts straight Dr/Cr between COGS and Inventory.
 * Always: Dr = Cr (spec section 61's own worked example).
 */
@Injectable()
export class InventoryCostAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_COST_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly fifo: FIFOEngine,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adjustment = await tx.inventoryCostAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    if (adjustment.lines.length === 0) throw new ValidationAppError('Cannot post a cost adjustment with no lines');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adjustment = await tx.inventoryCostAdjustment.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!adjustment) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adjustment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    const cogs = await this.mappings.resolve(tenantId, organizationId, MappingKeys.COGS, businessDate, tx);
    const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    // No new supplier payable is created by this document (unlike
    // AdditionalPurchaseCost, which already posts its own Cr Payable) — the
    // counter-leg for a standalone revaluation is the same
    // other-operating-expense/income contra InventoryAdjustmentPostingHandler
    // uses for write-off/surplus, since there is no better specific account.
    const expense = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx);
    const income = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_INCOME, businessDate, tx);

    const lines: AccountingPostingLineInput[] = [];

    for (const line of adjustment.lines) {
      const amount = new Decimal(line.adjustmentAmount.toString());
      if (amount.isZero()) continue;
      const increase = amount.gt(0);
      const contra = increase ? expense : income;

      let remainingShareAmount = amount.abs();
      let consumedShareAmount = new Decimal(0);

      if (line.costLayerId) {
        const split = await this.fifo.adjustLayerCost(tx, line.costLayerId, amount);
        await tx.inventoryCostAdjustmentLine.update({ where: { id: line.id }, data: { newUnitCost: split.newUnitCost.toString() } });
        remainingShareAmount = split.remainingShareAmount.abs();
        consumedShareAmount = split.consumedShareAmount.abs();
      }

      if (remainingShareAmount.gt(0)) {
        lines.push({ accountId: inventory.id, side: increase ? 'DEBIT' : 'CREDIT', amountBase: remainingShareAmount, description: `Cost adjustment (on-hand) — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }] });
      }
      if (consumedShareAmount.gt(0)) {
        lines.push({ accountId: cogs.id, side: increase ? 'DEBIT' : 'CREDIT', amountBase: consumedShareAmount, description: `Cost adjustment (already sold) — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }] });
      }
      lines.push({ accountId: contra.id, side: increase ? 'CREDIT' : 'DEBIT', amountBase: amount.abs(), description: `Cost adjustment counter-entry — ${adjustment.number ?? adjustment.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }] });
    }

    if (lines.length === 0) return null;
    return { description: `Inventory cost adjustment ${adjustment.number ?? adjustment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }
}
