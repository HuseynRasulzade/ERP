import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FIXED_ASSET_DISPOSAL_TYPE } from './fixed-asset-disposal.repository';

/**
 * Posting handler for FixedAssetDisposal (spec sections 65-73). Removes
 * `disposalShare` (1 = full, <1 = PROPORTIONAL_COST partial disposal,
 * spec section 72) of the gross cost/accumulated depreciation/impairment/
 * revaluation balances, recognizes `proceeds` less `disposalCosts` if
 * any, and derives gain/loss. Sale proceeds are never posted by
 * duplicating a sales invoice engine (spec section 68) — `proceeds` is a
 * plain recognized amount here (Dr Cash/AR / Cr Gain or Dr Loss), and
 * `salesInvoiceId` is only a traceability link, not a second posting of
 * the same invoice.
 */
@Injectable()
export class FixedAssetDisposalPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_DISPOSAL_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly movements: FixedAssetMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const disposal = await tx.fixedAssetDisposal.findFirst({ where: { id: document.id, tenantId } });
    if (!disposal) throw new ValidationAppError('Document disappeared during posting');
    const asset = await tx.fixedAsset.findFirst({ where: { id: disposal.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) throw new ValidationAppError('Asset is already fully disposed');
    if (new Decimal(disposal.disposalShare.toString()).lte(0) || new Decimal(disposal.disposalShare.toString()).gt(1)) throw new ValidationAppError('disposalShare must be between 0 (exclusive) and 1 (inclusive)');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const disposal = await tx.fixedAssetDisposal.findFirst({ where: { id: document.id, tenantId } });
    if (!disposal) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = disposal.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id: disposal.assetId } });
    const share = new Decimal(disposal.disposalShare.toString());

    const grossCostRemoved = new Decimal(asset.initialCost.toString()).mul(share);
    const accumulatedDepreciationRemoved = new Decimal(asset.accumulatedDepreciation.toString()).mul(share);
    const impairmentRemoved = new Decimal(asset.impairmentBalance.toString()).mul(share);
    const revaluationRemoved = new Decimal(asset.revaluationBalance.toString()).mul(share);
    const carryingAmountAtDisposal = grossCostRemoved.minus(accumulatedDepreciationRemoved).minus(impairmentRemoved).plus(revaluationRemoved);
    const proceeds = new Decimal(disposal.proceeds?.toString() ?? 0);
    const disposalCosts = new Decimal(disposal.disposalCosts.toString());
    const gainLoss = proceeds.minus(disposalCosts).minus(carryingAmountAtDisposal);

    await this.movements.record(
      tenantId,
      { organizationId, assetId: disposal.assetId, movementType: share.eq(1) ? 'FULL_DISPOSAL' : 'PARTIAL_DISPOSAL', costDecrease: grossCostRemoved, depreciationDecrease: accumulatedDepreciationRemoved, impairmentDecrease: impairmentRemoved, revaluationDecrease: revaluationRemoved, sourceDocumentType: FIXED_ASSET_DISPOSAL_TYPE, sourceDocumentId: disposal.id, effectiveDate: businessDate },
      tx,
    );

    await tx.fixedAssetDisposal.update({ where: { id: disposal.id }, data: { grossCostRemoved: grossCostRemoved.toString(), accumulatedDepreciationRemoved: accumulatedDepreciationRemoved.toString(), carryingAmountAtDisposal: carryingAmountAtDisposal.toString(), gainLoss: gainLoss.toString() } });

    const newStatus = share.eq(1) ? (disposal.disposalType === 'WRITE_OFF' ? 'WRITTEN_OFF' : 'DISPOSED') : 'PARTIALLY_DISPOSED';
    await tx.fixedAsset.update({ where: { id: disposal.assetId }, data: { status: newStatus, disposalDate: share.eq(1) ? businessDate : asset.disposalDate } });

    const costAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_COST, businessDate, tx).catch(() => null);
    const accDepAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.ACCUMULATED_DEPRECIATION, businessDate, tx).catch(() => null);
    if (!costAccount || !accDepAccount) return null;
    const gainAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_DISPOSAL_GAIN, businessDate, tx).catch(() => null);
    const lossAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_DISPOSAL_LOSS, businessDate, tx).catch(() => null);
    const proceedsAccount = proceeds.gt(0) ? await this.mappings.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, businessDate, tx).catch(() => null) : null;
    const dims = [{ dimensionCode: 'FIXED_ASSET', referenceId: disposal.assetId }];

    const lines: { accountId: string; side: 'DEBIT' | 'CREDIT'; amountBase: Decimal; description: string; dimensions: typeof dims }[] = [];
    lines.push({ accountId: accDepAccount.id, side: 'DEBIT', amountBase: accumulatedDepreciationRemoved, description: 'Accumulated depreciation removed', dimensions: dims });
    if (proceeds.gt(0) && proceedsAccount) lines.push({ accountId: proceedsAccount.id, side: 'DEBIT', amountBase: proceeds, description: 'Disposal proceeds', dimensions: dims });
    lines.push({ accountId: costAccount.id, side: 'CREDIT', amountBase: grossCostRemoved, description: 'Fixed asset cost removed', dimensions: dims });
    if (gainLoss.gt(0) && gainAccount) lines.push({ accountId: gainAccount.id, side: 'CREDIT', amountBase: gainLoss, description: 'Gain on disposal', dimensions: dims });
    if (gainLoss.lt(0) && lossAccount) lines.push({ accountId: lossAccount.id, side: 'DEBIT', amountBase: gainLoss.abs(), description: 'Loss on disposal', dimensions: dims });

    const debitTotal = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
    const creditTotal = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
    if (!debitTotal.eq(creditTotal)) return null; // an account mapping or gain/loss leg was unavailable — skip GL, subledger movement already recorded

    return { description: `Fixed asset disposal ${disposal.number ?? disposal.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const disposal = await tx.fixedAssetDisposal.findFirst({ where: { id: document.id, tenantId } });
    if (!disposal) return;
    await this.movements.reverse(tenantId, FIXED_ASSET_DISPOSAL_TYPE, document.id, tx);
    await tx.fixedAsset.update({ where: { id: disposal.assetId }, data: { status: 'ACTIVE', disposalDate: null } });
  }
}
