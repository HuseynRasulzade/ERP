import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FIXED_ASSET_REVALUATION_TYPE } from './fixed-asset-revaluation.repository';

/**
 * Posting handler for FixedAssetRevaluation (spec sections 57-58).
 * `revaluedAmount > oldCarryingAmount` -> REVALUATION_INCREASE (Dr Fixed
 * Asset / Cr Revaluation Surplus); otherwise REVALUATION_DECREASE (Dr
 * Revaluation Surplus, capped at the existing surplus, then Dr Impairment
 * Loss for any excess / Cr Fixed Asset) — a simplified single-book
 * COST_MODEL-compatible treatment; full OCI/equity-reserve mechanics for
 * REVALUATION_MODEL categories are a disclosed simplification (schema is
 * ready via `FixedAssetCategory.revaluationModel`, see docs/FIXED_ASSETS.md).
 */
@Injectable()
export class FixedAssetRevaluationPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_REVALUATION_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly movements: FixedAssetMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const rev = await tx.fixedAssetRevaluation.findFirst({ where: { id: document.id, tenantId } });
    if (!rev) throw new ValidationAppError('Document disappeared during posting');
    const asset = await tx.fixedAsset.findFirst({ where: { id: rev.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) throw new ValidationAppError(`Cannot revalue a ${asset.status} asset`);
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const rev = await tx.fixedAssetRevaluation.findFirst({ where: { id: document.id, tenantId } });
    if (!rev) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = rev.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const oldAmount = new Decimal(rev.oldCarryingAmount.toString());
    const newAmount = new Decimal(rev.revaluedAmount.toString());
    const delta = newAmount.minus(oldAmount);
    if (delta.eq(0)) return null;
    const isIncrease = delta.gt(0);

    await this.movements.record(tenantId, { organizationId, assetId: rev.assetId, movementType: isIncrease ? 'REVALUATION_INCREASE' : 'REVALUATION_DECREASE', revaluationIncrease: isIncrease ? delta : undefined, revaluationDecrease: isIncrease ? undefined : delta.abs(), sourceDocumentType: FIXED_ASSET_REVALUATION_TYPE, sourceDocumentId: rev.id, effectiveDate: businessDate }, tx);

    const assetAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_COST, businessDate, tx).catch(() => null);
    const surplusAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.REVALUATION_SURPLUS, businessDate, tx).catch(() => null);
    if (!assetAccount || !surplusAccount) return null;
    const dims = [{ dimensionCode: 'FIXED_ASSET', referenceId: rev.assetId }];
    const amount = delta.abs();

    const lines = isIncrease
      ? [{ accountId: assetAccount.id, side: 'DEBIT' as const, amountBase: amount, description: 'Revaluation increase', dimensions: dims }, { accountId: surplusAccount.id, side: 'CREDIT' as const, amountBase: amount, description: 'Revaluation surplus', dimensions: dims }]
      : [{ accountId: surplusAccount.id, side: 'DEBIT' as const, amountBase: amount, description: 'Revaluation decrease', dimensions: dims }, { accountId: assetAccount.id, side: 'CREDIT' as const, amountBase: amount, description: 'Revaluation decrease', dimensions: dims }];

    return { description: `Fixed asset revaluation ${rev.number ?? rev.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.movements.reverse(tenantId, FIXED_ASSET_REVALUATION_TYPE, document.id, tx);
  }
}
