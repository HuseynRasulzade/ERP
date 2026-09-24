import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { FaDocumentType, MovementType, RECOGNIZED_STATUSES, toDate } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { validateAssignmentRefs } from './fixed-asset-references';
import { FixedAssetInvalidStateError } from './fixed-asset.errors';

export interface TransferDto {
  assetIds: string[];
  date: string;
  toDepartmentId?: string;
  toLocationId?: string;
  toResponsiblePersonId?: string;
  toBranchId?: string;
  toCostCenterId?: string;
  toProjectId?: string;
  toExpenseType?: string;
  reason?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
}

/**
 * FixedAssetTransferService (spec sections 41-44, 105, 111, 154): internal
 * transfer of department / location / responsible person / branch / cost
 * center. Cost and NBV never change; the effective-dated assignment history
 * gets a new slice and future depreciation expense follows it.
 */
@Injectable()
export class FixedAssetTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
  ) {}

  async transfer(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: TransferDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.TRANSFER);
    return this.prisma.runInTransaction((tx) => this.transferInTx(tx, tenantId, organizationId, userId, dto));
  }

  async transferInTx(tx: PrismaTransactionClient, tenantId: string, organizationId: string, userId: string, dto: TransferDto) {
    if (!dto.assetIds?.length) throw new ValidationAppError('Select at least one asset');
    const hasTarget = [dto.toDepartmentId, dto.toLocationId, dto.toResponsiblePersonId, dto.toBranchId, dto.toCostCenterId, dto.toProjectId, dto.toExpenseType].some((v) => v !== undefined);
    if (!hasTarget) throw new ValidationAppError('A transfer must change at least one assignment field');
    const date = toDate(dto.date);
    await validateAssignmentRefs(tx, tenantId, organizationId, { branchId: dto.toBranchId, departmentId: dto.toDepartmentId, locationId: dto.toLocationId, responsiblePersonId: dto.toResponsiblePersonId });

    const lines = [];
    const assets = [];
    for (const assetId of [...new Set(dto.assetIds)].sort()) {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (!RECOGNIZED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; it cannot be transferred.`);
      const current = await this.history.currentAssignment(tenantId, assetId, tx);
      if (current && date.getTime() < current.validFrom.getTime()) {
        throw new ValidationAppError(`Transfer date is before the current assignment of ${asset.assetNumber} (effective ${current.validFrom.toISOString().slice(0, 10)})`);
      }
      assets.push(asset);
      lines.push({
        assetId,
        fromBranchId: asset.branchId,
        toBranchId: dto.toBranchId ?? asset.branchId,
        fromDepartmentId: asset.departmentId,
        toDepartmentId: dto.toDepartmentId ?? asset.departmentId,
        fromLocationId: asset.locationId,
        toLocationId: dto.toLocationId ?? asset.locationId,
        fromResponsiblePersonId: asset.responsiblePersonId,
        toResponsiblePersonId: dto.toResponsiblePersonId ?? asset.responsiblePersonId,
        fromCostCenterId: asset.costCenterId,
        toCostCenterId: dto.toCostCenterId ?? asset.costCenterId,
        carryingAmountBefore: asset.carryingAmount.toString(),
        carryingAmountAfter: asset.carryingAmount.toString(),
        details: { fromExpenseType: asset.expenseType, toExpenseType: dto.toExpenseType ?? asset.expenseType },
      });
    }

    const doc = await this.documents.create(tx, {
      tenantId,
      organizationId,
      documentType: FaDocumentType.TRANSFER,
      documentDate: date,
      userId,
      reason: dto.reason,
      sourceDocumentType: dto.sourceDocumentType,
      sourceDocumentId: dto.sourceDocumentId,
      description: `Internal transfer of ${assets.length} asset(s)`,
      lines,
    });

    for (const [i, asset] of assets.entries()) {
      await this.history.assign(tx, {
        tenantId,
        assetId: asset.id,
        validFrom: date,
        values: {
          ...(dto.toDepartmentId !== undefined ? { departmentId: dto.toDepartmentId } : {}),
          ...(dto.toLocationId !== undefined ? { locationId: dto.toLocationId } : {}),
          ...(dto.toResponsiblePersonId !== undefined ? { responsiblePersonId: dto.toResponsiblePersonId } : {}),
          ...(dto.toBranchId !== undefined ? { branchId: dto.toBranchId } : {}),
          ...(dto.toCostCenterId !== undefined ? { costCenterId: dto.toCostCenterId } : {}),
          ...(dto.toProjectId !== undefined ? { projectId: dto.toProjectId } : {}),
          ...(dto.toExpenseType !== undefined ? { expenseType: dto.toExpenseType } : {}),
        },
        sourceDocumentType: FaDocumentType.TRANSFER,
        sourceDocumentId: doc.id,
        createdBy: userId,
        reason: dto.reason,
      });
      await this.ledger.write(tx, {
        tenantId,
        organizationId,
        assetId: asset.id,
        movementType: MovementType.TRANSFER,
        businessDate: date,
        departmentId: dto.toDepartmentId ?? asset.departmentId,
        locationId: dto.toLocationId ?? asset.locationId,
        sourceDocumentType: FaDocumentType.TRANSFER,
        sourceDocumentId: doc.id,
        sourceDocumentLineId: doc.lines[i].id,
        description: 'Internal transfer (no value change)',
        createdBy: userId,
      });
      await tx.fixedAsset.update({ where: { id: asset.id }, data: { version: { increment: 1 }, updatedBy: userId } });
      await this.audit.record(
        { tenantId, eventType: 'FixedAssetTransferred', entityType: 'FixedAsset', entityId: asset.id, action: 'TRANSFER', userId, oldValues: { departmentId: asset.departmentId, locationId: asset.locationId, responsiblePersonId: asset.responsiblePersonId }, newValues: { ...lines[i], documentId: doc.id }, reason: dto.reason },
        tx,
      );
    }
    return doc;
  }
}
