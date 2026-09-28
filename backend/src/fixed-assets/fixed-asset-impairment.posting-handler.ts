import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from './fixed-asset-impairment.repository';
import {
  FIXED_ASSET_MOVEMENT_REGISTER,
  FixedAssetBalanceService,
} from './fixed-asset-balance.service';

/**
 * Posting handler for FixedAssetImpairment (docx spec Phase 16 sections
 * 52-56). IMPAIRMENT: Dr Impairment Loss (731) / Cr Accumulated
 * Depreciation (112 — the AZ chart's own combined depreciation+impairment
 * line, spec section 54). REVERSAL: the opposite direction, capped at the
 * asset's own live accumulated-impairment balance (spec section 56:
 * "never exceed" prior impairment). Future depreciation recalculates
 * automatically next run since FixedAssetDepreciationService always reads
 * the LIVE NBV (spec section 55) — no separate hook needed here.
 */
@Injectable()
export class FixedAssetImpairmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_IMPAIRMENT_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const impairment = await tx.fixedAssetImpairment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!impairment)
      throw new ValidationAppError('Document disappeared during posting');
    if (impairment.impairmentAmount.lte(0))
      throw new ValidationAppError(
        'Cannot post an impairment with a non-positive amount',
      );
    const asset = await tx.fixedAsset.findFirst({
      where: { id: impairment.assetId, tenantId },
    });
    if (!asset)
      throw new ValidationAppError('Impairment references an unknown asset');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status))
      throw new ValidationAppError(`Cannot impair a ${asset.status} asset`);

    if (impairment.impairmentType === 'REVERSAL') {
      const current = await this.balances.getBalances(
        tenantId,
        impairment.assetId,
        document.postingDate ?? document.documentDate,
        tx,
      );
      if (
        new Decimal(impairment.impairmentAmount.toString()).gt(
          current.accumulatedImpairment,
        )
      ) {
        throw new ValidationAppError(
          `Reversal of ${impairment.impairmentAmount.toString()} exceeds the asset's accumulated impairment of ${current.accumulatedImpairment.toFixed(2)}`,
        );
      }
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const impairment = await tx.fixedAssetImpairment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!impairment)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const isReversal = impairment.impairmentType === 'REVERSAL';
    return [
      {
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate,
        movementType: isReversal ? 'IMPAIRMENT_REVERSAL' : 'IMPAIRMENT',
        dimensions: {
          organizationId: impairment.organizationId,
          assetId: impairment.assetId,
        },
        resources: isReversal
          ? { impairmentDecrease: impairment.impairmentAmount.toString() }
          : { impairmentIncrease: impairment.impairmentAmount.toString() },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const impairment = await tx.fixedAssetImpairment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!impairment)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(impairment.impairmentAmount.toString());
    const isReversal = impairment.impairmentType === 'REVERSAL';

    const accumulatedAccount = await this.mappings.resolve(
      tenantId,
      impairment.organizationId,
      MappingKeys.ACCUMULATED_DEPRECIATION,
      businessDate,
      tx,
    );
    const dims = [
      { dimensionCode: 'FIXED_ASSET', referenceId: impairment.assetId },
    ];

    let lines: AccountingPostingLineInput[];
    if (isReversal) {
      const gainAccount = await this.mappings.resolve(
        tenantId,
        impairment.organizationId,
        MappingKeys.DISPOSAL_GAIN,
        businessDate,
        tx,
      );
      lines = [
        {
          accountId: accumulatedAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Impairment reversal ${impairment.number ?? impairment.id}`,
          dimensions: dims,
        },
        {
          accountId: gainAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Impairment reversal ${impairment.number ?? impairment.id}`,
          dimensions: [],
        },
      ];
    } else {
      const lossAccount = await this.mappings.resolve(
        tenantId,
        impairment.organizationId,
        MappingKeys.IMPAIRMENT_LOSS,
        businessDate,
        tx,
      );
      lines = [
        {
          accountId: lossAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Impairment ${impairment.number ?? impairment.id}`,
          dimensions: [],
        },
        {
          accountId: accumulatedAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Impairment ${impairment.number ?? impairment.id}`,
          dimensions: dims,
        },
      ];
    }

    return {
      description: `Fixed asset impairment ${impairment.number ?? impairment.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
