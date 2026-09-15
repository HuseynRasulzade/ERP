import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FIXED_ASSET_TRANSFER_TYPE } from './fixed-asset-transfer.repository';

/**
 * Posting handler for FixedAssetTransfer (spec sections 41-44). No GL
 * consequence for the carrying value (same "dimension-only relocation"
 * shape as `CashDeskTransferPostingHandler`) — only department/location/
 * responsible-person assignment changes. A TRANSFER movement is still
 * recorded (zero-amount) purely for the history trail (spec sections
 * 43-44's own "current field history-ni əvəz etməməlidir").
 */
@Injectable()
export class FixedAssetTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_TRANSFER_TYPE;

  constructor(private readonly movements: FixedAssetMovementService) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.fixedAssetTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const asset = await tx.fixedAsset.findFirst({ where: { id: transfer.assetId, tenantId } });
    if (!asset) throw new ValidationAppError('Linked fixed asset not found');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) throw new ValidationAppError(`Cannot transfer a ${asset.status} asset`);
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.fixedAssetTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id: transfer.assetId } });

    await this.movements.record(tenantId, { organizationId: transfer.organizationId, assetId: transfer.assetId, movementType: 'TRANSFER', sourceDocumentType: FIXED_ASSET_TRANSFER_TYPE, sourceDocumentId: transfer.id, effectiveDate: businessDate }, tx);
    await tx.fixedAsset.update({
      where: { id: transfer.assetId },
      data: {
        departmentId: transfer.toDepartmentId ?? asset.departmentId,
        locationId: transfer.toLocationId ?? asset.locationId,
        responsiblePersonId: transfer.toResponsiblePersonId ?? asset.responsiblePersonId,
      },
    });

    return null; // no GL consequence — see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.fixedAssetTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) return;
    await this.movements.reverse(tenantId, FIXED_ASSET_TRANSFER_TYPE, document.id, tx);
    await tx.fixedAsset.update({
      where: { id: transfer.assetId },
      data: {
        departmentId: transfer.fromDepartmentId ?? undefined,
        locationId: transfer.fromLocationId ?? undefined,
        responsiblePersonId: transfer.fromResponsiblePersonId ?? undefined,
      },
    });
  }
}
