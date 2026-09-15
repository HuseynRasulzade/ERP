import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** FixedAssetSuspension (spec section 51) — no GL consequence by itself;
 * `depreciationPolicy` is read by `FixedAssetDepreciationService` when
 * deciding an asset's eligibility for a period (spec section 29). */
@Injectable()
export class FixedAssetSuspensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async suspend(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { assetId: string; startDate: string; reason?: string; depreciationPolicy?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    if (asset.status === 'SUSPENDED') throw new ValidationAppError('Asset is already suspended');

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.fixedAssetSuspension.create({ data: { tenantId, assetId: dto.assetId, startDate: this.parseDate(dto.startDate), reason: dto.reason, depreciationPolicy: dto.depreciationPolicy ?? 'PAUSE_DEPRECIATION', createdBy: userId } });
      await tx.fixedAsset.update({ where: { id: dto.assetId }, data: { status: 'SUSPENDED', depreciationEligible: (dto.depreciationPolicy ?? 'PAUSE_DEPRECIATION') !== 'PAUSE_DEPRECIATION' } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_SUSPENDED', entityType: 'FIXED_ASSET_SUSPENSION', entityId: row.id, action: 'CREATE', userId, newValues: dto }, tx);
      return row;
    });
  }

  async end(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, endDate: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const suspension = await this.prisma.fixedAssetSuspension.findFirst({ where: { id, tenantId, status: 'ACTIVE' } });
    if (!suspension) throw new NotFoundAppError('FixedAssetSuspension', id);

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.fixedAssetSuspension.update({ where: { id }, data: { status: 'ENDED', endDate: this.parseDate(endDate) } });
      await tx.fixedAsset.update({ where: { id: suspension.assetId }, data: { status: 'ACTIVE', depreciationEligible: true } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_SUSPENSION_ENDED', entityType: 'FIXED_ASSET_SUSPENSION', entityId: id, action: 'UPDATE', userId, newValues: { endDate } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetSuspension.findMany({ where: { tenantId, assetId }, orderBy: { startDate: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
