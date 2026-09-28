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
import { FIXED_ASSET_MODERNIZATION_TYPE } from './fixed-asset-modernization.repository';
import { FIXED_ASSET_MOVEMENT_REGISTER } from './fixed-asset-balance.service';

/**
 * Posting handler for FixedAssetModernization (docx spec Phase 16
 * sections 45-49) — posting IS the capitalization event: Dr Fixed Asset
 * Cost / Cr a neutral Other-Operating-Income wash (disclosed
 * simplification: this build does not link modernization funding to a
 * supplier payable — use the acquisition-candidate ASSIGN_TO_ASSET path
 * instead when a real supplier invoice funds the work). Gross carrying
 * amount increases; useful life/residual value are changed separately via
 * FixedAssetService.changeUsefulLife (kept out of this document so
 * unposting a modernization never has to also unwind a prospective
 * useful-life checkpoint).
 */
@Injectable()
export class FixedAssetModernizationPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_MODERNIZATION_TYPE;

  constructor(private readonly mappings: AccountingMappingService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const modernization = await tx.fixedAssetModernization.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!modernization)
      throw new ValidationAppError('Document disappeared during posting');
    if (modernization.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post a modernization with a non-positive amount',
      );
    const asset = await tx.fixedAsset.findFirst({
      where: { id: modernization.assetId, tenantId },
    });
    if (!asset)
      throw new ValidationAppError('Modernization references an unknown asset');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status))
      throw new ValidationAppError(`Cannot modernize a ${asset.status} asset`);
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const modernization = await tx.fixedAssetModernization.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!modernization)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    return [
      {
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'MODERNIZATION',
        dimensions: {
          organizationId: modernization.organizationId,
          assetId: modernization.assetId,
        },
        resources: { costIncrease: modernization.amount.toString() },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const modernization = await tx.fixedAssetModernization.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!modernization)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(modernization.amount.toString());

    const costAccount = await this.mappings.resolve(
      tenantId,
      modernization.organizationId,
      MappingKeys.FIXED_ASSET_COST,
      businessDate,
      tx,
    );
    const washAccount = await this.mappings.resolve(
      tenantId,
      modernization.organizationId,
      MappingKeys.OTHER_OPERATING_INCOME,
      businessDate,
      tx,
    );

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: costAccount.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Modernization ${modernization.number ?? modernization.id}`,
        dimensions: [
          { dimensionCode: 'FIXED_ASSET', referenceId: modernization.assetId },
        ],
      },
      {
        accountId: washAccount.id,
        side: 'CREDIT',
        amountBase: amount,
        description: `Modernization ${modernization.number ?? modernization.id}`,
        dimensions: [],
      },
    ];

    return {
      description: `Fixed asset modernization ${modernization.number ?? modernization.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
