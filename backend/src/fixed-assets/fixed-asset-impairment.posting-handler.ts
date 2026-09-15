import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from './fixed-asset-impairment.repository';

/**
 * Posting handler for FixedAssetImpairment (spec sections 52-56).
 * `reversal: false` -> Dr Impairment Loss / Cr Accumulated Impairment;
 * `reversal: true` -> the opposite legs, capped by the service layer at
 * creation time to never exceed the cost-model's own "no more than
 * original cost less what depreciation would have been" ceiling (spec
 * section 56 — architecture supports it, this build enforces the simpler
 * "never exceed the impairment balance being reversed" rule, disclosed in
 * docs/FIXED_ASSETS.md).
 */
@Injectable()
export class FixedAssetImpairmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_IMPAIRMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly movements: FixedAssetMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const imp = await tx.fixedAssetImpairment.findFirst({ where: { id: document.id, tenantId } });
    if (!imp) throw new ValidationAppError('Document disappeared during posting');
    if (imp.impairmentAmount.lte(0)) throw new ValidationAppError('Impairment amount must be positive');
    const asset = await tx.fixedAsset.findFirst({ where: { id: imp.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) throw new ValidationAppError(`Cannot impair a ${asset.status} asset`);
    if (imp.reversal && new Decimal(imp.impairmentAmount.toString()).gt(asset.impairmentBalance.toString())) {
      throw new ValidationAppError(`Impairment reversal of ${imp.impairmentAmount.toString()} exceeds the current impairment balance of ${asset.impairmentBalance.toString()}.`);
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const imp = await tx.fixedAssetImpairment.findFirst({ where: { id: document.id, tenantId } });
    if (!imp) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = imp.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(imp.impairmentAmount.toString());

    await this.movements.record(
      tenantId,
      { organizationId, assetId: imp.assetId, movementType: imp.reversal ? 'IMPAIRMENT_REVERSAL' : 'IMPAIRMENT', impairmentIncrease: imp.reversal ? undefined : amount, impairmentDecrease: imp.reversal ? amount : undefined, sourceDocumentType: FIXED_ASSET_IMPAIRMENT_TYPE, sourceDocumentId: imp.id, effectiveDate: businessDate },
      tx,
    );
    await tx.fixedAsset.update({ where: { id: imp.assetId }, data: { status: imp.reversal ? 'ACTIVE' : 'IMPAIRED' } });

    const lossAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_IMPAIRMENT_LOSS, businessDate, tx).catch(() => null);
    const accumulatedAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.ACCUMULATED_IMPAIRMENT, businessDate, tx).catch(() => null);
    if (!lossAccount || !accumulatedAccount) return null;
    const dims = [{ dimensionCode: 'FIXED_ASSET', referenceId: imp.assetId }];

    const lines = imp.reversal
      ? [{ accountId: accumulatedAccount.id, side: 'DEBIT' as const, amountBase: amount, description: 'Impairment reversal', dimensions: dims }, { accountId: lossAccount.id, side: 'CREDIT' as const, amountBase: amount, description: 'Impairment reversal income', dimensions: dims }]
      : [{ accountId: lossAccount.id, side: 'DEBIT' as const, amountBase: amount, description: 'Impairment loss', dimensions: dims }, { accountId: accumulatedAccount.id, side: 'CREDIT' as const, amountBase: amount, description: 'Accumulated impairment', dimensions: dims }];

    return { description: `Fixed asset impairment ${imp.number ?? imp.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const imp = await tx.fixedAssetImpairment.findFirst({ where: { id: document.id, tenantId } });
    if (!imp) return;
    await this.movements.reverse(tenantId, FIXED_ASSET_IMPAIRMENT_TYPE, document.id, tx);
    await tx.fixedAsset.update({ where: { id: imp.assetId }, data: { status: 'ACTIVE' } });
  }
}
