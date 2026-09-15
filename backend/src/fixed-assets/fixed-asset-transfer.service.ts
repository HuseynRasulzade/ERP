import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_TRANSFER_TYPE } from './fixed-asset-transfer.repository';

const SEQUENCE_PREFIX = 'FATR';

@Injectable()
export class FixedAssetTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { assetId: string; toDepartmentId?: string; toLocationId?: string; toResponsiblePersonId?: string; reason?: string; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    if (!dto.toDepartmentId && !dto.toLocationId && !dto.toResponsiblePersonId) throw new ValidationAppError('At least one of toDepartmentId/toLocationId/toResponsiblePersonId is required');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_TRANSFER_TYPE, documentDate, tx);
      const row = await tx.fixedAssetTransfer.create({
        data: {
          tenantId,
          organizationId,
          assetId: dto.assetId,
          fromDepartmentId: asset.departmentId,
          toDepartmentId: dto.toDepartmentId,
          fromLocationId: asset.locationId,
          toLocationId: dto.toLocationId,
          fromResponsiblePersonId: asset.responsiblePersonId,
          toResponsiblePersonId: dto.toResponsiblePersonId,
          reason: dto.reason,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_TRANSFER_CREATED', entityType: FIXED_ASSET_TRANSFER_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: dto }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetTransfer.findMany({ where: { organizationId, assetId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FIXED_ASSET_TRANSFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FIXED_ASSET_TRANSFER_TYPE, documentType: FIXED_ASSET_TRANSFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
