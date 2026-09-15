import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FIXED_ASSET_CAPITALIZATION_TYPE } from './fixed-asset-capitalization.repository';
import { FixedAssetMovementService } from './fixed-asset-movement.service';

/**
 * Posting handler for FixedAssetCapitalization (spec sections 11, 88-90).
 * Two shapes:
 *  - CIP-sourced (`cipProjectId` set): Dr FIXED_ASSET_COST / Cr
 *    FIXED_ASSET_CIP for the capitalized amount — the CIP's own cost
 *    lines were already posted to the CIP account by whatever module fed
 *    them (spec section 88).
 *  - Direct (`cipProjectId` null, spec section 89): the source Purchase
 *    Invoice/Goods Receipt already posted its own GL treatment for the
 *    acquisition; this build does not attempt to re-derive and re-credit
 *    that original account here (double-booking risk) — only the
 *    FixedAssetMovement (subledger) records INITIAL_RECOGNITION, and no
 *    automatic GL entry is posted. Disclosed simplification, see
 *    docs/FIXED_ASSETS.md — a manual journal entry closes the gap today.
 * Either way, cost lines feeding this capitalization are stamped
 * `capitalizedToAssetId` and their candidates marked CAPITALIZED.
 */
@Injectable()
export class FixedAssetCapitalizationPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_CAPITALIZATION_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly movements: FixedAssetMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const cap = await tx.fixedAssetCapitalization.findFirst({ where: { id: document.id, tenantId } });
    if (!cap) throw new ValidationAppError('Document disappeared during posting');
    if (cap.amount.lte(0)) throw new ValidationAppError('Cannot post a capitalization with non-positive amount');
    const asset = await tx.fixedAsset.findFirst({ where: { id: cap.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (asset.status !== 'ACQUISITION') throw new ValidationAppError(`Asset is already ${asset.status} — capitalization can only post once per asset`);
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const cap = await tx.fixedAssetCapitalization.findFirst({ where: { id: document.id, tenantId } });
    if (!cap) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = cap.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(cap.amount.toString());

    await this.movements.record(tenantId, { organizationId, assetId: cap.assetId, movementType: 'INITIAL_RECOGNITION', costIncrease: amount, sourceDocumentType: FIXED_ASSET_CAPITALIZATION_TYPE, sourceDocumentId: cap.id, effectiveDate: businessDate }, tx);

    await tx.fixedAsset.update({ where: { id: cap.assetId }, data: { status: 'ACCEPTED', acceptanceDate: businessDate } });
    await tx.capitalInvestmentCostLine.updateMany({ where: { tenantId, capitalizedToAssetId: cap.assetId, capitalizable: true }, data: {} }); // lines are already stamped at capitalize() time, see service
    await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { tenantId, assignedAssetId: cap.assetId }, data: { status: 'CAPITALIZED' } });

    const dims = [{ dimensionCode: 'FIXED_ASSET', referenceId: cap.assetId }, { dimensionCode: 'CURRENCY', referenceId: cap.currencyId }];
    if (!cap.cipProjectId) return null; // direct capitalization — see class doc

    const assetAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_COST, businessDate, tx).catch(() => null);
    const cipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.FIXED_ASSET_CIP, businessDate, tx).catch(() => null);
    if (!assetAccount || !cipAccount) return null;

    return { description: `Fixed asset capitalization ${cap.number ?? cap.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: assetAccount.id, side: 'DEBIT', amountBase: amount, description: 'Fixed asset capitalized from CIP', dimensions: dims }, { accountId: cipAccount.id, side: 'CREDIT', amountBase: amount, description: 'CIP capitalized', dimensions: dims }] };
  }

  /** Blocked once the asset has moved past ACCEPTED (spec section 134's
   * "əgər asset artıq commissioned/depreciated/disposed-dursa capitalization
   * reverse edilə bilməz"). */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const cap = await tx.fixedAssetCapitalization.findFirst({ where: { id: document.id, tenantId } });
    if (!cap) return;
    const asset = await tx.fixedAsset.findFirst({ where: { id: cap.assetId, tenantId } });
    if (asset && asset.status !== 'ACCEPTED') throw new ValidationAppError(`Cannot unpost — asset has already progressed to ${asset?.status}. Reverse dependent commissioning/depreciation/disposal first.`);

    await this.movements.reverse(tenantId, FIXED_ASSET_CAPITALIZATION_TYPE, document.id, tx);
    await tx.fixedAsset.update({ where: { id: cap.assetId }, data: { status: 'ACQUISITION', acceptanceDate: null } });
    await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { tenantId, assignedAssetId: cap.assetId }, data: { status: 'ASSIGNED_TO_ASSET' } });
  }
}
