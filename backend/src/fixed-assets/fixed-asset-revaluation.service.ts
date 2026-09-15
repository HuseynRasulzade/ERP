import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_REVALUATION_TYPE } from './fixed-asset-revaluation.repository';

const SEQUENCE_PREFIX = 'FAREV';

@Injectable()
export class FixedAssetRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { assetId: string; revaluedAmount: number; valuationSource?: string; reason?: string; documentDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_REVALUATION_TYPE, documentDate, tx);
      const row = await tx.fixedAssetRevaluation.create({
        data: {
          tenantId,
          organizationId,
          assetId: dto.assetId,
          oldCarryingAmount: asset.carryingAmount.toString(),
          revaluedAmount: dto.revaluedAmount.toString(),
          valuationSource: dto.valuationSource,
          reason: dto.reason,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_REVALUED', entityType: FIXED_ASSET_REVALUATION_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { oldCarryingAmount: asset.carryingAmount.toString(), revaluedAmount: dto.revaluedAmount } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetRevaluation.findMany({ where: { organizationId, assetId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FIXED_ASSET_REVALUATION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FIXED_ASSET_REVALUATION_TYPE, documentType: FIXED_ASSET_REVALUATION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
