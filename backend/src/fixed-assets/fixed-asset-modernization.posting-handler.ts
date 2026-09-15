import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FIXED_ASSET_MODERNIZATION_TYPE } from './fixed-asset-modernization.repository';

/**
 * Posting handler for FixedAssetModernization (spec sections 45-47).
 * Increases gross carrying amount and, when given, applies a prospective
 * useful-life/residual-value change (spec sections 35-36 — original
 * history is never overwritten, only the go-forward fields change). No
 * automatic GL entry: the underlying cost was already posted by whatever
 * source document incurred it (a purchase invoice, a CIP capitalization
 * elsewhere) — re-crediting that here risks double-booking, the same
 * reasoning `FixedAssetCapitalizationPostingHandler` applies to direct
 * capitalization. Disclosed simplification, see docs/FIXED_ASSETS.md; the
 * MODERNIZATION subledger movement is still recorded so the asset
 * register and reporting reflect the new cost immediately.
 */
@Injectable()
export class FixedAssetModernizationPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_MODERNIZATION_TYPE;

  constructor(private readonly movements: FixedAssetMovementService) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const mod = await tx.fixedAssetModernization.findFirst({ where: { id: document.id, tenantId } });
    if (!mod) throw new ValidationAppError('Document disappeared during posting');
    if (mod.amount.lte(0)) throw new ValidationAppError('Cannot post a modernization with non-positive amount');
    const asset = await tx.fixedAsset.findFirst({ where: { id: mod.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) throw new ValidationAppError(`Cannot modernize a ${asset.status} asset`);
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const mod = await tx.fixedAssetModernization.findFirst({ where: { id: document.id, tenantId } });
    if (!mod) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(mod.amount.toString());

    await this.movements.record(tenantId, { organizationId: mod.organizationId, assetId: mod.assetId, movementType: 'MODERNIZATION', costIncrease: amount, sourceDocumentType: FIXED_ASSET_MODERNIZATION_TYPE, sourceDocumentId: mod.id, effectiveDate: businessDate }, tx);

    await tx.fixedAsset.update({
      where: { id: mod.assetId },
      data: {
        status: 'ACTIVE', // returns from UNDER_MODERNIZATION if it was set there
        ...(mod.newUsefulLifeMonths ? { usefulLifeMonths: mod.newUsefulLifeMonths, remainingUsefulLifeMonths: mod.newUsefulLifeMonths } : {}),
        ...(mod.newResidualValue != null ? { residualValue: mod.newResidualValue.toString() } : {}),
      },
    });

    return null; // no automatic GL — see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const mod = await tx.fixedAssetModernization.findFirst({ where: { id: document.id, tenantId } });
    if (!mod) return;
    await this.movements.reverse(tenantId, FIXED_ASSET_MODERNIZATION_TYPE, document.id, tx);
  }
}
